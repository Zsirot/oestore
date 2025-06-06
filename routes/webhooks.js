const express = require("express");
const router = express.Router();
const AppError = require("../utils/AppError");
const axios = require("axios").default;
const morgan = require("morgan");
const crypto = require("crypto");
const { webhookSchema } = require("../schemas");

const Order = require("../models/order");
const { Product, Variant } = require("../models/product");
const { assignAllAvailable, specifyWebhookTracking } = require("../seeds");

if (process.env.NODE_ENV !== "production") {
  //if we are not in production mode
  require("dotenv").config(); //require our .env file,
}

const stripe = require("stripe")(process.env.STRIPE_KEY);
const stripeEndpointSecret = process.env.STRIPE_WEBHOOK;
const printfulWebhookSecret = process.env.PRINTFUL_WEBHOOK_SECRET;

const rateLimit = require("express-rate-limit");

// Improved rate limiter configuration
const webhookLimiter = rateLimit({
  windowMs: 2 * 60 * 1000, // 2 minutes
  max: 2, // limit each IP to 2 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    error: "Too Many Requests",
    message: "Please try again later",
  },
});

// Validate Printful webhook signature
const validatePrintfulWebhook = (req, res, next) => {
  const signature = req.headers["x-printful-signature"];

  if (!signature) {
    console.error("Missing Printful webhook signature");
    return res.status(401).json({ error: "Missing webhook signature" });
  }

  if (!printfulWebhookSecret) {
    console.error("Printful webhook secret not configured");
    return res.status(500).json({ error: "Webhook configuration error" });
  }

  // Create HMAC hash of the request body using the webhook secret
  const hmac = crypto.createHmac("sha256", printfulWebhookSecret);
  const digest = hmac.update(JSON.stringify(req.body)).digest("hex");

  // Compare the computed hash with the signature from Printful
  if (digest !== signature) {
    console.error("Invalid Printful webhook signature");
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  next();
};

const deleteIncompleteOrders = async function () {
  const deleteOrders = await Order.deleteMany({ fulfilled: false });
  console.log(`${deleteOrders.deletedCount} incomplete orders deleted`);
};
deleteIncompleteOrders(); //runs on server start
setInterval(deleteIncompleteOrders, 1000 * 60 * 60 * 24); //runs every 24 hours

const printfulConfig = {
  headers: { Authorization: `Bearer ${process.env.API_KEY}` },
};

const fulfillOrder = async function (stripeOrderId) {
  try {
    const completedOrder = await stripe.checkout.sessions.retrieve(
      stripeOrderId
    ); //stripeOrderId comes from a successfully completed payment
    const orderDoc = await Order.findById(completedOrder.metadata.orderId);
    if (!orderDoc) {
      console.warn(
        "Order not found in database for fulfillment:",
        completedOrder.metadata.orderId
      );
      return; // Do not throw, just return early
    }
    const { customer, items } = orderDoc;

    let cartItems = [];
    for (item of items) {
      //creates a new array from the items in the fulfilled order (found in the DB), preparing payload for printful order fulfilment
      cartItems.push({
        sync_variant_id: item.sync_variant_id,
        quantity: item.qty,
        retail_price: item.price,
        currency: "USD",
      });
    }
    // Build recipient object dynamically
    const recipient = {
      name: [customer.first_name, customer.last_name].join(" "),
      address1: customer.address_1,
      address2: customer.address_2,
      city: customer.city,
      country_code: customer.country, // Use dynamic country code
      zip: customer.zip,
      email: customer.email,
    };
    if (!customer.country) {
      console.error(
        "ERROR: country_code is missing from customer data!",
        customer
      );
      throw new AppError(
        "Order fulfillment failed: country_code is missing from customer data.",
        400
      );
    }
    if (customer.state) {
      recipient.state_code = customer.state;
    }
    console.log("Printful recipient payload:", recipient);
    const response = await axios.post(
      "https://api.printful.com/orders",
      {
        recipient,
        items: cartItems,
      },
      printfulConfig
    );
    const order = await Order.findByIdAndUpdate(
      completedOrder.metadata.orderId,
      { fulfilled: true },
      { new: true }
    ); //Updates the completedOrder to 'true' in the DB
    order.save();
    console.log(
      `ORDER COMPLETE: ${response.data.result.recipient.email} ${response.data.result.dashboard_url}`
    );
  } catch (e) {
    const errorMsg = e?.raw?.message || e?.message || "Unknown error";
    console.error("fulfillOrder error:", errorMsg);
    throw new AppError("Failed to process order", 400);
  }
};

router.post(
  "/stripe",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const payload = req.body;
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        payload,
        sig,
        stripeEndpointSecret
      );
    } catch (err) {
      console.error("Stripe webhook error:", err.message);
      return res.status(400).json({ error: "Invalid webhook signature" });
    }
    if (event.type === "checkout.session.completed") {
      const stripeOrderId = event.data.object.id;
      fulfillOrder(stripeOrderId);
    }
    console.log("Stripe payment succeeded");
    res.status(200).send();
  }
);

//Workaround for printful problem resending webhooks multiple times and triggering multiple stock refreshes
//Only allows one stock update webhook every 30 seconds:

let triggerBlock = false; //block is set to "false" initially

function refreshTrigger() {
  //when, called sets block to "false" in order to receive another update
  let triggerBlock = false;
  console.log("trigger reset");
}

// Validate webhook payload
const validateWebhookPayload = (req, res, next) => {
  const { error } = webhookSchema.validate(req.body);
  if (error) {
    console.error("Invalid webhook payload:", error.details[0].message);
    return res.status(400).json({ error: "Invalid webhook payload" });
  }
  next();
};

router.post(
  "/printful",
  webhookLimiter,
  express.json(),
  validateWebhookPayload,
  validatePrintfulWebhook,
  async (req, res) => {
    if (!triggerBlock) {
      //if block is "false", tells printful message received, blocks the any further requests, and runs functions
      console.log("accepted");
      res.status(200).send();
      triggerBlock = true;
      assignAllAvailable(); // refreshes the database with live stock info from printful
      await specifyWebhookTracking(); // tells printful which items' stock to track after they were assigned above
      setTimeout(refreshTrigger, 30 * 1000); //stops blocking requests after 30 seceonds
    } else {
      res.status(200).send(); //notifies printful that any additional requests were received.
      console.log("rejected");
    }
  }
);

module.exports = router;
