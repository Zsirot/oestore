// Configuration and Setup
console.log("[seeds.js] Script started");
const mongoose = require("mongoose");
const axios = require("axios").default;
const { Product, Variant } = require("./models/product");
const AppError = require("./utils/AppError");

// Load environment variables
require("dotenv").config();

// MongoDB Configuration
const MONGODB_CONFIG = {
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 30000,
  maxPoolSize: 10,
};

// Initialize MongoDB connection
mongoose.connect(process.env.DB_URL, MONGODB_CONFIG);

mongoose.connection.on("error", (err) => {
  console.error("[seeds.js] MongoDB connection error:", err);
  process.exit(1);
});

mongoose.connection.once("open", () => {
  console.log("[seeds.js] Connected to MongoDB");
});

// Environment Configuration
const getEnvironmentUrl = () => {
  return process.env.NODE_ENV !== "production"
    ? process.env.NGROK_URL
    : process.env.URL;
};

const url = getEnvironmentUrl();
console.log(
  "[seeds.js] Environment variables loaded. URL:",
  url,
  "API_KEY:",
  process.env.API_KEY ? "set" : "not set"
);

// Printful API Configuration
const printfulConfig = {
  headers: { Authorization: `Bearer ${process.env.API_KEY}` },
};

// Product Variant Processing
const processVariant = function (product, syncVariant, stockInfo) {
  // Check stock status
  const stockStatus = stockInfo.find(
    (obj) => obj.variant_id === syncVariant.variant_id
  );
  const isInStock = stockStatus?.stock !== "supplier_out_of_stock";

  // Extract variant attributes
  const variantData = {
    name: syncVariant.name,
    variant_id: syncVariant.variant_id,
    inStock: isInStock,
    sync_variant_id: syncVariant.id,
    retail_price: syncVariant.retail_price,
    size: syncVariant.size || "",
    color: syncVariant.color || "",
    variant_img: syncVariant.files[1].preview_url,
  };

  product.variants.push(variantData);
};

// Price Range Calculation
const calculatePriceRange = (variants) => {
  const prices = variants.map((variant) => variant.retail_price);
  const max = Math.max(...prices);
  const min = Math.min(...prices);
  return `${min} - ${max}`;
};

// Product Description Processing
const processProductDescription = (catalogInfo) => {
  const descriptionParts = catalogInfo.product.description.split("\u2022");
  return {
    head: descriptionParts[0],
    bullets: descriptionParts.slice(1),
  };
};

// Stock Information Processing
const processStockInfo = (catalogInfo) => {
  return catalogInfo.variants.map((variant) => ({
    variant_id: variant.id,
    stock: variant.availability_status[0].status,
  }));
};

// Product Building and Saving
const fetchAndBuildProduct = async (syncProductId) => {
  console.log(
    `\n[fetchAndBuildProduct] Starting for syncProductId: ${syncProductId}`
  );

  try {
    // Fetch sync product data
    const syncProductRes = await axios.get(
      `https://api.printful.com/store/products/${syncProductId}`,
      printfulConfig
    );
    const { sync_product, sync_variants } = syncProductRes.data.result;

    console.log(
      `[fetchAndBuildProduct] Fetched sync product: ${sync_product.name}`
    );

    // Initialize product object
    const product = {
      id: syncProductId,
      name: sync_product.name,
      thumbnail_url:
        sync_product.thumbnail_url ||
        sync_variants[0]?.files[1]?.preview_url ||
        "",
      stock_product_id: sync_variants[0].product.product_id,
      variants: [],
    };

    // Fetch stock product data
    const stockRes = await axios.get(
      `https://api.printful.com/products/${product.stock_product_id}`,
      printfulConfig
    );
    console.log(
      `[fetchAndBuildProduct] Fetched stock product for: ${product.name}`
    );

    const catalogInfo = stockRes.data.result;
    product.description = processProductDescription(catalogInfo);

    // Process variants
    const stockInfo = processStockInfo(catalogInfo);
    console.log(
      `[fetchAndBuildProduct] Processing ${sync_variants.length} sync variants...`
    );

    sync_variants.forEach((syncVariant) => {
      processVariant(product, syncVariant, stockInfo);
    });

    // Calculate price range
    product.price_range = calculatePriceRange(product.variants);

    // Create and save product
    const finalProduct = new Product({
      product_id: product.id,
      stock_product_id: product.stock_product_id,
      name: product.name.split("(")[0].trim(),
      description: product.description,
      price_range: product.price_range,
      thumbnail_url: product.thumbnail_url,
      variants: [],
    });

    // Save variants and update product
    let savedVariants = 0;
    for (const variant of product.variants) {
      if (variant.inStock) {
        const newVariant = new Variant({
          ...variant,
          parent: finalProduct._id,
        });
        await newVariant.save();
        savedVariants++;
        finalProduct.variants.push(newVariant._id);
      }
    }

    await finalProduct.save();
    console.log(
      `[fetchAndBuildProduct] Saved product: ${finalProduct.name} with ${savedVariants} variants.`
    );
  } catch (error) {
    if (error.response?.statusText === "Not Found") {
      console.log(
        "error:",
        "a stock product is discontinued or out of stock. Remove it from your printful store"
      );
    } else {
      console.error(
        `[fetchAndBuildProduct] Error for syncProductId ${syncProductId}:`,
        error
      );
    }
  }
};

// Database Management Functions
const clearDatabase = async () => {
  console.log(
    `\n[clearDatabase] Deleting all existing products and variants...`
  );
  await Product.deleteMany({});
  await Variant.deleteMany({});
  console.log(`[clearDatabase] Database cleared successfully.`);
};

const assignAll = async function (...productIds) {
  await clearDatabase();
  console.log(`[assignAll] Processing ${productIds.length} productIds...`);

  for (const productId of productIds) {
    await fetchAndBuildProduct(productId);
  }

  console.log(`[assignAll] Done processing all products.`);
};

const assignAllAvailable = async () => {
  console.log(
    `\n[assignAllAvailable] Fetching all products from Printful store...`
  );

  try {
    const response = await axios.get(
      "https://api.printful.com/store/products",
      printfulConfig
    );

    const products = response.data.result;
    const syncProductIds = products.map((product) => product.id);

    console.log(
      `[assignAllAvailable] Found ${syncProductIds.length} products. Assigning all...`
    );
    await assignAll(...syncProductIds);

    return console.log("[assignAllAvailable] All products assigned");
  } catch (error) {
    console.error(
      "[assignAllAvailable] Error fetching products from Printful:",
      error.response ? error.response.data : error
    );
  }
};

// Webhook Configuration
const specifyWebhookTracking = async () => {
  try {
    const allProducts = await Product.find({});
    const stockProductIds = allProducts.map((prod) => prod.stock_product_id);

    const response = await axios.post(
      "https://api.printful.com/webhooks",
      {
        url: `${url}/webhooks/printful`,
        types: ["stock_updated", "product_synced", "product_updated"],
        params: {
          stock_updated: {
            product_ids: stockProductIds,
          },
        },
      },
      printfulConfig
    );

    console.log("Webhook configuration sent successfully!");
  } catch (error) {
    console.error("Error configuring webhooks:", error);
    throw new AppError(error.response, error.status);
  }
};

// Production Mode Check
console.log("[seeds.js] NODE_ENV:", process.env.NODE_ENV);
console.log("[seeds.js] Calling assignAllAvailable...");
try {
  assignAllAvailable().catch((error) =>
    console.error("[seeds.js] assignAllAvailable error:", error)
  );
} catch (error) {
  console.error("[seeds.js] Error calling assignAllAvailable:", error);
}

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
