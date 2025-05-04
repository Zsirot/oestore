console.log("[seeds.js] Script started");
const mongoose = require("mongoose");
const axios = require("axios").default;
const { Product, Variant } = require("./models/product");
const AppError = require("./utils/AppError");

// Load environment variables first
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

// Add MongoDB connection options
mongoose.connect(process.env.DB_URL, {
  serverSelectionTimeoutMS: 30000, // 30 seconds
  socketTimeoutMS: 45000, // 45 seconds
  connectTimeoutMS: 30000, // 30 seconds
  maxPoolSize: 10,
});

mongoose.connection.on("error", (err) => {
  console.error("[seeds.js] MongoDB connection error:", err);
  process.exit(1);
});

mongoose.connection.once("open", () => {
  console.log("[seeds.js] Connected to MongoDB");
});

let url = process.env.URL;
if (process.env.NODE_ENV !== "production") {
  //if we ar enot in production mode
  url = process.env.NGROK_URL;
}
console.log(
  "[seeds.js] Environment variables loaded. URL:",
  url,
  "API_KEY:",
  process.env.API_KEY ? "set" : "not set"
);

const printfulConfig = {
  headers: { Authorization: `Bearer ${process.env.API_KEY}` },
};

const pushColor = function (product, syncVariant, stockInfo) {
  let stockTrack = stockInfo.filter((obj) => {
    return obj.variant_id === syncVariant.variant_id;
  });
  if (stockTrack[0].stock === "supplier_out_of_stock") {
    stockTrack = false;
  } else {
    stockTrack = true;
  }
  // Improved color and size extraction
  const parts = syncVariant.name.split("/");
  let color = "";
  let size = "";
  if (parts.length > 2) {
    color = parts[parts.length - 2].trim();
    size = parts[parts.length - 1].trim();
  } else if (parts.length === 2) {
    size = parts[1].trim();
  }
  // Debug output
  console.log(
    "[pushColor] Variant name:",
    syncVariant.name,
    "| parts:",
    parts,
    "| color:",
    color,
    "| size:",
    size
  );

  product.variants.push({
    name: syncVariant.name.split("(")[0].trim(),
    variant_id: syncVariant.variant_id,
    inStock: stockTrack,
    sync_variant_id: syncVariant.id,
    variant_img: syncVariant.files[1].preview_url,
    retail_price: parseInt(syncVariant.retail_price),
    size,
    color,
  });
};

const pushNoColor = function (product, syncVariant, stockInfo) {
  let stockTrack = stockInfo.filter((obj) => {
    return obj.variant_id === syncVariant.variant_id;
  });
  if (stockTrack[0].stock === "supplier_out_of_stock") {
    stockTrack = false;
  } else {
    stockTrack = true;
  }
  const parts = syncVariant.name.split("/");
  let size = "";
  let color = "";
  if (parts.length > 2) {
    color = parts[parts.length - 2].trim();
    size = parts[parts.length - 1].trim();
  } else if (parts.length === 2) {
    size = parts[1].trim();
  }
  // Debug output
  console.log(
    "[pushNoColor] Variant name:",
    syncVariant.name,
    "| parts:",
    parts,
    "| color:",
    color,
    "| size:",
    size
  );

  product.variants.push({
    name: syncVariant.name,
    variant_id: syncVariant.variant_id,
    inStock: stockTrack,
    sync_variant_id: syncVariant.id,
    retail_price: syncVariant.retail_price,
    size,
    color,
    variant_img: syncVariant.files[1].preview_url,
  });
};

const calcPriceRange = (product) => {
  const prices = [];
  for (let variant of product.variants) {
    prices.push(variant.retail_price);
  }
  const max = Math.max(...prices);
  const min = Math.min(...prices);
  const result = `${min} - ${max}`;
  return result;
};

const fetchAndBuildProduct = async (syncProductId) => {
  // Returns a customized sync product object (and variants) from a sync product ID.
  console.log(
    `\n[fetchAndBuildProduct] Starting for syncProductId: ${syncProductId}`
  );
  try {
    const res = await axios.get(
      `https://api.printful.com/store/products/${syncProductId}`,
      printfulConfig
    ); //Gets information about a single Sync Product and its Sync Variants
    console.log(
      `[fetchAndBuildProduct] Fetched sync product:`,
      res.data.result.sync_product.name
    );
    const syncVariants = res.data.result.sync_variants; //gets sync variant info
    const { name, thumbnail_url } = res.data.result.sync_product; //gets sync product info

    // If thumbnail_url is missing, use the first variant's image as a fallback
    const fallbackThumbnail = syncVariants[0]?.files[1]?.preview_url || "";

    const product = {
      id: syncProductId,
      name,
      thumbnail_url: thumbnail_url || fallbackThumbnail,
      stock_product_id: syncVariants[0].product.product_id, //stock product id here is only listed on any one of a product's variants, used to make the next GET request
      variants: [],
    };
    const stockRes = await axios.get(
      `https://api.printful.com/products/${product.stock_product_id}`,
      printfulConfig
    ); //Gets stock product info from a stock_product_id above
    console.log(`[fetchAndBuildProduct] Fetched stock product for: ${name}`);
    const catalogInfo = stockRes.data.result; // extracts result
    const description = {
      //extracts description and formats bullets
      head: catalogInfo.product.description.split("\u2022")[0],
      bullets: catalogInfo.product.description.split("\u2022").splice(1),
    };
    product.description = description; //adds description to product object
    let stockInfo = [];
    for (let variant of catalogInfo.variants) {
      ///this adds a new array for pushColor/pushNoColor to check availability against stock variant ids
      stockInfo.push({
        variant_id: variant.id, // stock variant ids
        stock: variant.availability_status[0].status, //stock variant id availability
      });
    }
    console.log(
      `[fetchAndBuildProduct] Processing ${syncVariants.length} sync variants...`
    );
    for (let syncVariant of syncVariants) {
      if (syncVariant.name.includes("(Colors Available)")) {
        pushColor(product, syncVariant, stockInfo);
      } else {
        pushNoColor(product, syncVariant, stockInfo);
      }
    }
    product.price_range = calcPriceRange(product);
    const final = new Product({
      product_id: product.id,
      stock_product_id: product.stock_product_id,
      name: product.name.split("(")[0].trim(),
      description: {
        head: product.description.head,
        bullets: product.description.bullets,
      },
      price_range: product.price_range,
      thumbnail_url: product.thumbnail_url,
      variants: [],
    });
    let savedVariants = 0;
    for (let variant of product.variants) {
      if (variant.inStock === true) {
        const vrnt = new Variant({
          name: variant.name,
          variant_id: variant.variant_id,
          inStock: variant.inStock,
          sync_variant_id: variant.sync_variant_id,
          size: variant.size,
          color: variant.color,
          retail_price: variant.retail_price,
          variant_img: variant.variant_img,
          parent: product._id,
        });
        await vrnt.save();
        savedVariants++;
        final.variants.push(vrnt._id);
      }
    }
    await final.save();
    console.log(
      `[fetchAndBuildProduct] Saved product: ${final.name} with ${savedVariants} variants.`
    );
  } catch (e) {
    if (e.response && e.response.statusText === "Not Found") {
      console.log(
        "error:",
        "a stock product is discontinued or out of stock. Remove it from your printful store"
      );
    } else {
      console.error(
        `[fetchAndBuildProduct] Error for syncProductId ${syncProductId}:`,
        e
      );
    }
  }
};

const assignAll = async function (...productIds) {
  console.log(`\n[assignAll] Deleting all existing products and variants...`);
  await Product.deleteMany({});
  await Variant.deleteMany({});
  console.log(
    `[assignAll] Deleted. Now processing ${productIds.length} productIds...`
  );
  for (const productId of productIds) {
    await fetchAndBuildProduct(productId);
  }
  console.log(`[assignAll] Done processing all products.`);
};

const assignAllAvailable = async () => {
  console.log(
    `\n[assignAllAvailable] Fetching all products from Printful store...`
  );
  let res;
  try {
    res = await axios.get(
      "https://api.printful.com/store/products",
      printfulConfig
    );
  } catch (apiErr) {
    console.error(
      "[assignAllAvailable] Error fetching products from Printful:",
      apiErr.response ? apiErr.response.data : apiErr
    );
    return;
  }
  const products = res.data.result;
  const syncProductIds = [];
  for (let product of products) {
    syncProductIds.push(product.id);
  }
  console.log(
    `[assignAllAvailable] Found ${syncProductIds.length} products. Assigning all...`
  );
  await assignAll(...syncProductIds);
  return console.log("[assignAllAvailable] All products assigned");
};

const specifyWebhookTracking = async () => {
  // Specifies a list of events and products that trigger a webhook
  try {
    let stockProductIds = [];
    const allProds = await Product.find({}); //finds all products in DB

    for (let prod of allProds) {
      //adds each product's stock product id to an array
      stockProductIds.push(prod.stock_product_id);
    }
    const res = await axios.post(
      "https://api.printful.com/webhooks",
      {
        //posts triggering events and product ids to printful (including array from above)
        url: `${url}/webhooks/printful`, //this should be a variable or the final site url
        types: ["stock_updated", "product_synced", "product_updated"],
        params: {
          stock_updated: {
            product_ids: stockProductIds,
          },
        },
      },
      printfulConfig
    );
    console.log("configuration sent!!");

    // console.log(res.data.result)
  } catch (e) {
    console.log("error");
    throw new AppError(e.response, e.status);
  }
};

console.log("[seeds.js] NODE_ENV:", process.env.NODE_ENV);
if (process.env.NODE_ENV === "production") {
  //if we are in production mode, refresh database on server start
  console.log("[seeds.js] Calling assignAllAvailable...");
  try {
    assignAllAvailable().catch((e) =>
      console.error("[seeds.js] assignAllAvailable error:", e)
    );
  } catch (e) {
    console.error("[seeds.js] Error calling assignAllAvailable:", e);
  }
}
// fetchAndBuildProduct(218275569)
// assignAllAvailable()

module.exports = { assignAllAvailable, specifyWebhookTracking };

// Sync Products

// 218275569 Skyline Tank Top
// 259595944 Cuffed Beanie  (Colors Available)
// 259609932 Mug with Color Inside
// 218275623 Starlet's Letterman Jacket
// 218274071 Layer Bikini (Colors Available)
// 218274605 3\4 Sleeve Streetlamp Raglan Shirt
// 218275526 Short Sleeve Skyline T Shirt
// 218275656 Short Sleeve Beach T Shirt (Colors Available)
// 218274678 Short Sleeve Unisex Skyline T Shirt
// 218274347 Short Sleeve Layers V Neck T Shirt
