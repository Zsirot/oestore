const express = require("express");
const router = express.Router();
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const axios = require("axios").default;

const Cart = require("../cart");
const Order = require("../models/order");
const currency = require("currency.js");
const {
  verifyConfirmation,
  verifyCheckout,
} = require("../utils/verifications");

let url = process.env.URL;
if (process.env.NODE_ENV !== "production") {
  //if we ar enot in production mode
  require("dotenv").config(); //require our .env file,
  url = process.env.NGROK_URL;
}

console.log(
  "Loaded API_KEY:",
  process.env.API_KEY ? process.env.API_KEY.slice(0, 6) + "..." : "NOT SET"
);

const stripe = require("stripe")(process.env.STRIPE_KEY);

const calcShipping = async (customer, items) => {
  try {
    // Build recipient object dynamically
    const recipient = {
      name: [customer.first_name, customer.last_name].join(" "),
      address1: customer.address_1,
      address2: customer.address_2,
      city: customer.city,
      country_code: customer.country,
      zip: customer.zip,
    };
    if (customer.state) {
      recipient.state_code = customer.state;
    }
    const response = await axios.post(
      "https://api.printful.com/orders/estimate-costs",
      {
        recipient,
        items,
      },
      {
        headers: { Authorization: `Bearer ${process.env.API_KEY}` },
      }
    );
    const { subtotal, shipping, tax, vat } = response.data.result.costs;

    const retailCost = response.data.result.retail_costs.subtotal;
    prices = {
      subtotal,
      shipping,
      tax,
      vat: Number(vat) || 0,
      total: parseFloat((retailCost + shipping + (tax || 0)).toFixed(2)),
      retailCost: retailCost.toFixed(2),
    };
    console.log("calcShipping prices:", prices);
    return prices;
  } catch (e) {
    throw new AppError(e.response.data.result, 400);
  }
};

router.get("/", verifyCheckout, (req, res) => {
  let cart = {};
  if (!req.session.cart) {
    cart = new Cart();
  } else {
    const { data, items, totals } = req.session.cart;
    cart = new Cart(data, items, totals);
  }
  cart.calculateTotals();
  res.render("checkout", { cart });
});

router.patch("/:id", (req, res) => {
  try {
    let cart = {};
    const { data, items, totals } = req.session.cart;
    cart = new Cart(data, items, totals);
    const qty = req.body.qty;
    const productId = req.params.id;
    cart.updateCart([productId], [qty]);
    cart.saveCart(req);
    req.flash("success", "Item quantity updated");
    res.redirect("/store/checkout");
  } catch (e) {
    throw new AppError("Item not in cart", 404);
  }
});

router.delete("/:id", (req, res) => {
  try {
    let cart = {};
    const { data, items, totals } = req.session.cart;
    cart = new Cart(data, items, totals);
    const productId = req.params.id;
    cart.removeFromCart(productId);
    cart.saveCart(req);
    if (cart.data.items.length == 0) {
      req.flash("success", "No items in cart, returned to store");
      return res.redirect("/store");
    }
    req.flash("success", "Item removed from cart");
    res.redirect("/store/checkout");
  } catch (e) {
    throw new AppError("Item not in cart", 404);
  }
});

router.post(
  "/",
  verifyCheckout,
  catchAsync(async (req, res) => {
    try {
      console.log("Checkout POST body:", req.body); // Debug log
      if (!req.body.country) {
        req.flash("error", "Country is required. Please select a country.");
        return res.redirect("/store/checkout");
      }
      const { data, items, totals } = req.session.cart;
      cart = new Cart(data, items, totals);
      // Sanitize and coerce customer fields before saving to session
      const customer = {
        first_name: req.body.first_name,
        last_name: req.body.last_name,
        email: req.body.email,
        address_1: req.body.address_1,
        address_2: req.body.address_2,
        city: req.body.city,
        state: req.body.state,
        zip: req.body.zip ? parseInt(req.body.zip.trim(), 10) : undefined,
        country: req.body.country,
      };
      req.session.customer = customer;
      let prices = {};
      let cartItems = [];
      for (item of cart.data.items) {
        cartItems.push({
          sync_variant_id: item.sync_variant_id,
          quantity: item.qty,
          retail_price: item.price,
          currency: "USD",
        });
      }
      customer.prices = await calcShipping(customer, cartItems);
      prices = customer.prices;
      res.render("confirm", { cart, prices, customer });
    } catch (e) {
      throw new AppError(e.message, 400);
    }
  })
);

router.post(
  "/confirm",
  verifyCheckout,
  verifyConfirmation,
  catchAsync(async (req, res) => {
    try {
      const customer = req.session.customer; //retrieve customer info from session
      let cart = {};
      const { data, items, totals } = req.session.cart;
      cart = new Cart(data, items, totals);
      let line_items = [];
      for (let item of cart.data.items) {
        //for each item in the cart...
        const itemData = {
          //map a new object
          price_data: {
            currency: "usd", //US shipping only. Autofilled
            product_data: {
              name: item.title,
              images: [item.image],
              // metadata: {
              //     sync_variant_id: item.sync_variant_id
              // }
            },
            unit_amount_decimal: currency(item.price).intValue,
          },
          quantity: item.qty,
        };
        // console.log(itemData.price_data.product_data)
        line_items.push(itemData);
      }
      line_items.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: "Shipping",
          },
          unit_amount_decimal: currency(customer.prices.shipping).intValue,
        },
        quantity: 1,
      });
      // Add tax as a line item if present and > 0
      if (customer.prices.tax && customer.prices.tax > 0) {
        line_items.push({
          price_data: {
            currency: "usd",
            product_data: {
              name: "Tax",
            },
            unit_amount_decimal: currency(customer.prices.tax).intValue,
          },
          quantity: 1,
        });
      }
      // --- Extra validation: require state if country has states ---
      const countriesRes = await axios.get(
        "https://api.printful.com/countries",
        {
          headers: { Authorization: `Bearer ${process.env.API_KEY}` },
        }
      );
      const countries = countriesRes.data.result;
      const selectedCountry = countries.find(
        (c) => c.code.toLowerCase() === customer.country.toLowerCase()
      );
      if (
        selectedCountry &&
        selectedCountry.states &&
        selectedCountry.states.length > 0
      ) {
        if (!customer.state) {
          req.flash(
            "error",
            "State/Province is required for the selected country."
          );
          return res.redirect("/store/checkout");
        }
      }
      // --- End extra validation ---

      // Build recipient object dynamically
      console.log(
        "Session customer before order creation:",
        req.session.customer
      );
      const recipient = {
        name: [customer.first_name, customer.last_name].join(" "),
        address1: customer.address_1,
        address2: customer.address_2,
        city: customer.city,
        country_code: customer.country,
        zip: customer.zip,
        email: customer.email,
      };
      if (customer.state) {
        recipient.state_code = customer.state;
      }

      const order = new Order({
        items,
        customer,
        fulfilled: false,
      });
      order.save();
      const session = await stripe.checkout.sessions.create({
        customer_email: customer.email,
        submit_type: "pay",
        line_items,
        metadata: {
          orderId: `${order._id}`,
        },
        payment_method_types: ["card"],
        mode: "payment",
        success_url: `${url}/store/checkout/receipt?order_id=${order._id}`,
        cancel_url: `${url}/store/checkout`,
      });
      customer.order_id = order._id;

      // Make sure customer.prices is up to date with all fields (including VAT)
      customer.prices = prices;
      req.session.customer = customer;
      console.log("customer.prices before order creation:", customer.prices);

      // Add a 3-second delay before redirecting to the Stripe session URL
      setTimeout(() => {
        res.redirect(303, session.url);
      }, 3000);
    } catch (e) {
      req.flash("error", "Confirmation expired, returning to checkout");
      res.redirect("/store/checkout");
    }
  })
);

router.get(
  "/receipt",
  catchAsync(async (req, res) => {
    try {
      const orderId = req.query.order_id;
      const order = await Order.findById(orderId); //find order in db
      console.log("Order in /receipt route:", order);
      if (order) {
        const { customer, items } = order;
        const prices = customer.prices;
        res.render("receipt", { customer, items, prices, order });
        if (order.fulfilled === true) {
          req.session.cart = null;
          req.session.save(); // Ensure session is saved after clearing cart
        }
      } else {
        req.flash(
          "error",
          "Order not found. Please check your email for a receipt or contact support."
        );
        res.redirect("/store");
      }
    } catch (e) {
      req.flash(
        "error",
        "Order confirmation expired or failed. Please check your email for a receipt or contact support."
      );
      res.redirect("/store");
    }
  })
);

// Proxy route for Printful countries API
router.get("/printful-countries", async (req, res) => {
  try {
    const response = await axios.get("https://api.printful.com/countries", {
      headers: { Authorization: `Bearer ${process.env.API_KEY}` },
    });

    // Get the countries array
    const countries = response.data.result;

    // Sort countries alphabetically, but put US first
    const sortedCountries = countries.sort((a, b) => {
      if (a.code === "US") return -1;
      if (b.code === "US") return 1;
      return a.name.localeCompare(b.name);
    });

    res.json({
      result: sortedCountries,
    });
  } catch (error) {
    console.error("Error fetching countries:", error.message);
    res.status(500).json({ error: "Failed to fetch countries" });
  }
});

// Proxy route for Printful states API
router.get("/printful-states/:countryCode", async (req, res) => {
  try {
    const { countryCode } = req.params;
    console.log("Fetching states for:", countryCode);

    // First get all countries
    const response = await axios({
      method: "get",
      url: "https://api.printful.com/countries",
      headers: {
        Authorization: `Bearer ${process.env.API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    // Find the specific country in the response
    const countries = response.data.result;
    const country = countries.find(
      (c) => c.code.toLowerCase() === countryCode.toLowerCase()
    );

    console.log("Found country:", country);

    // Check if the country has states in the correct structure
    if (country && country.states && Array.isArray(country.states)) {
      // Country has states
      res.json({
        result: {
          states: country.states,
        },
      });
    } else {
      // Country doesn't have states or states is not in the expected format
      console.log("No states found for country:", countryCode);
      res.json({
        result: {
          states: [],
        },
      });
    }
  } catch (error) {
    console.error("Error details:", {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
    });

    res.status(500).json({
      error: "Failed to fetch states",
      details: error.response?.data || error.message,
      status: error.response?.status,
    });
  }
});

module.exports = router;
