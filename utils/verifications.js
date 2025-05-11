const Joi = require("joi");

const verifyCheckout = (req, res, next) => {
  if (!req.session.cart || !req.session.cart.items[0]) {
    req.flash("error", "Your cart is empty");
    res.redirect("/store");
  } else {
    return next();
  }
};

const verifyConfirmation = (req, res, next) => {
  const checkoutSchema = Joi.object({
    cart: Joi.object().required(),
    customer: Joi.object({
      first_name: Joi.string().required(),
      last_name: Joi.string().required(),
      email: Joi.string().email().required(),
      address_1: Joi.string().required(),
      city: Joi.string().required(),
      state: Joi.string().allow("", null),
      zip: Joi.number().required(),
      prices: Joi.object().required(),
    }),
  }).options({ allowUnknown: true });
  const { error } = checkoutSchema.validate(req.session);

  if (error) {
    console.error(
      "Confirmation validation error:",
      error.details.map((el) => el.message).join(",")
    );
    req.flash("error", "Please complete your checkout information");
    return res.redirect("/store/checkout");
  } else {
    next();
  }
};

module.exports = { verifyCheckout, verifyConfirmation };
