const Joi = require("joi");

// Product variant validation
module.exports.variantSchema = Joi.object({
  prodId: Joi.number().required(),
  imgUrl: Joi.string().required(),
  title: Joi.string().required(),
  size: Joi.string(),
  qty: Joi.number().required().min(1).max(100),
  color: Joi.string(),
});

// Customer information validation
module.exports.customerSchema = Joi.object({
  first_name: Joi.string().required().trim().min(2).max(50),
  last_name: Joi.string().required().trim().min(2).max(50),
  email: Joi.string().required().email().trim(),
  address_1: Joi.string().required().trim().min(5).max(100),
  address_2: Joi.string().allow("").trim().max(100),
  city: Joi.string().required().trim().min(2).max(50),
  state: Joi.string().allow("", null).trim().max(50),
  zip: Joi.number().required().min(10000).max(99999),
  country: Joi.string().required().trim().length(2),
});

// Cart item validation
module.exports.cartItemSchema = Joi.object({
  title: Joi.string().required(),
  price: Joi.number().required().min(0),
  qty: Joi.number().required().min(1).max(100),
  image: Joi.string().required(),
  color: Joi.string().allow(""),
  size: Joi.string().allow(""),
  sync_variant_id: Joi.number().required(),
});

// Order validation
module.exports.orderSchema = Joi.object({
  fulfilled: Joi.boolean().required(),
  items: Joi.array().items(module.exports.cartItemSchema).required(),
  customer: module.exports.customerSchema.required(),
});

// Webhook payload validation
module.exports.webhookSchema = Joi.object({
  type: Joi.string().required(),
  data: Joi.object().required(),
});
