# Only Echoes Band Website & Ecommerce Store

Live Demo: [https://oe-store-app-06f0d6d6c068.herokuapp.com/](https://oe-store-app-06f0d6d6c068.herokuapp.com/)

A full-stack ecommerce web application for the Only Echoes band, featuring a custom Printful (print-on-demand) integration and Stripe payments. The app supports dynamic product management, order fulfillment, and a modern shopping experience.

---

## Tech Stack

- **Backend:** Node.js, Express.js, MongoDB (Mongoose)
- **Frontend:** EJS, Bootstrap 5, Vanilla JS
- **Payments:** Stripe
- **Fulfillment:** Printful API
- **Other:** dotenv, helmet, morgan, express-session, connect-mongo

---

## Features

- Seamless integration with Printful (product sync, stock updates, fulfillment)
- Secure Stripe payment processing (test mode enabled)
- Shopping cart overlay sidebar
- Automatic MongoDB seeding from Printful store
- Dynamic store page population
- Product seed refresh via Printful webhook
- Order processing only on successful Stripe payment (via webhook)
- Country/state dropdowns powered by Printful API

---

## Prerequisites

- Node.js (v14+ recommended)
- MongoDB Atlas or local MongoDB instance
- Stripe account (test mode)
- Printful account with store items

---

## Setup Instructions

1. **Clone the repository:**

   ```bash
   git clone <repo-url>
   cd Onlyechoesv2
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Configure environment variables:**
   Create a `.env` file in the root directory with the following keys:

   ```env
   URL=your_production_url
   NGROK_URL=your_ngrok_url (for local dev)
   STRIPE_WEBHOOK=your_stripe_webhook_secret
   STRIPE_KEY=your_stripe_secret_key
   SESSION_STORE=your_session_store_secret
   SESSION_SECRET=your_session_secret
   PORT=80 (or your preferred port)
   DB_URL=your_mongodb_connection_string
   API_KEY=your_printful_api_key
   NODE_ENV=production or development
   PRINTFUL_API_TOKEN=your_printful_api_key
   PRINTFUL_WEBHOOK_SECRET=your_printful_webhook_secret
   ```

   > **Note:** The `PRINTFUL_WEBHOOK_SECRET` is used to validate incoming webhooks from Printful. Generate a secure random string (at least 32 characters) for this value. The same secret must be configured in your Printful webhook settings.

4. **Seed the database:**

   ```bash
   node seeds.js
   ```

   This will fetch products from your Printful store and populate the MongoDB database.

5. **Start the application:**
   ```bash
   npm start
   ```
   The app will be available at the URL specified in your `.env` file.

---

## Usage

- Visit `/store` to browse products and add items to your cart.
- Proceed to checkout and use the following Stripe test card:
  - Card Number: `4242 4242 4242 4242`
  - Any future expiry, any CVC, any ZIP
- Orders are only fulfilled after successful payment.

---

## API Endpoints (Main)

### Store

- `GET /store` — View all products
- `POST /store` — Add item to cart
- `DELETE /store` — Empty cart
- `DELETE /store/:id` — Remove item from cart
- `PATCH /store/:id` — Update item quantity

### Checkout

- `GET /store/checkout` — View cart and checkout
- `POST /store/checkout` — Submit shipping info, calculate shipping
- `POST /store/checkout/confirm` — Confirm and pay
- `PATCH/DELETE /store/checkout/:id` — Update/remove cart item

### Webhooks

- `POST /webhooks/stripe` — Stripe payment webhook
- `POST /webhooks/printful` — Printful stock update webhook (requires signature validation)

> **Webhook Security:**
>
> - Stripe webhooks are validated using the `STRIPE_WEBHOOK` secret
> - Printful webhooks are validated using the `PRINTFUL_WEBHOOK_SECRET`
> - Both webhook endpoints are rate-limited to prevent abuse
> - Always use HTTPS in production

---

## Development & Deployment

- For local development, use [ngrok](https://ngrok.com/) to expose your local server for Stripe/Printful webhooks.
- Deploy to Heroku, Render, or any Node.js-compatible host.

---

## Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

---

## License

[MIT](LICENSE) - See the [LICENSE](LICENSE) file for details

---
