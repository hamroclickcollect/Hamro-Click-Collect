const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const db = new Database("shop.db");

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  photo TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  items TEXT NOT NULL,
  total REAL NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'Pending'
);
`);

// पुरानो orders table मा status नभए थप्ने
// Products table मा पसलेको मोबाइल नम्बर थप्ने
const productColumns = db.prepare("PRAGMA table_info(products)").all();

if (!productColumns.some(column => column.name === "seller_phone")) {
  db.exec("ALTER TABLE products ADD COLUMN seller_phone TEXT");
}
const orderColumns = db.prepare("PRAGMA table_info(orders)").all();
if (!orderColumns.some(column => column.name === "status")) {
  db.exec("ALTER TABLE orders ADD COLUMN status TEXT NOT NULL DEFAULT 'Pending'");
}

app.post("/api/register", async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;

    if (!name || !phone || !email || !password || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "सबै विवरण भर्नुहोस्। Password कम्तीमा ६ अक्षरको हुनुपर्छ।"
      });
    }

    const hash = await bcrypt.hash(password, 10);

    db.prepare(
      "INSERT INTO users (name, phone, email, password) VALUES (?, ?, ?, ?)"
    ).run(name, phone, email, hash);

    res.json({ success: true, message: "Account created" });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: "यो मोबाइल वा Email पहिले नै प्रयोग भएको हुन सक्छ।"
    });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { phone, email, password } = req.body;

    const user = db.prepare(
      "SELECT * FROM users WHERE phone = ? OR email = ?"
    ).get(phone || "", email || "");

    if (!user || !(await bcrypt.compare(password || "", user.password))) {
      return res.status(401).json({
        success: false,
        message: "Login विवरण मिलेन।"
      });
    }

    res.json({ success: true, name: user.name });
  } catch (error) {
    res.status(500).json({ success: false, message: "Login गर्दा समस्या भयो।" });
  }
});

app.post("/api/products", (req, res) => {
  try {
    const { name, price, photo, seller_phone } = req.body;

    if (!name || !price || Number(price) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Please enter the name and correct price of the item."
      });
    }

    db.prepare(
      "INSERT INTO products (name, price, photo, seller_phone) VALUES (?, ?, ?, ?)"
    ).run(name, Number(price), photo || "", seller_phone || "");

    res.json({ success: true, message: "Item added." });

  } catch (error) {
    console.error("Add product error:", error);
    res.status(500).json({
      success: false,
      message: "There was a problem adding stuff."
    });
  }
});
app.post("/api/orders", (req, res) => {
  try {
    const { customer_name, phone, items, total } = req.body;

    if (
      !customer_name ||
      !phone ||
      !Array.isArray(items) ||
      items.length === 0 ||
      !Number.isFinite(Number(total)) ||
      Number(total) < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Fill all details."
      });
    }

    const result = db.prepare(
      "INSERT INTO orders (customer_name, phone, items, total, status) VALUES (?, ?, ?, ?, ?)"
    ).run(
      customer_name,
      phone,
      JSON.stringify(items),
      Number(total),
      "Pending"
    );

    res.json({
      success: true,
      message: "Order successful.",
      orderId: result.lastInsertRowid,
      status: "Pending"
    });

  } catch (error) {
    console.error("Order error:", error);
    res.status(500).json({
      success: false,
      message: "There was a problem placing the order."
    });
  }
});
// Customer: आफ्नो Order Status हेर्ने
app.get("/api/orders/track", (req, res) => {
  try {
    const orderId = Number(req.query.orderId);
    const phone = String(req.query.phone || "").trim();

    if (!Number.isInteger(orderId) || orderId <= 0 || !phone) {
      return res.status(400).json({
        message: "Order Number र मोबाइल नम्बर राख्नुहोस्।"
      });
    }

    const order = db.prepare(`
      SELECT id, customer_name, phone, total, status, created_at
      FROM orders
      WHERE id = ? AND phone = ?
    `).get(orderId, phone);

    if (!order) {
      return res.status(404).json({
        message: "अर्डर भेटिएन। विवरण जाँच गर्नुहोस्।"
      });
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({
      message: "अर्डर खोज्दा समस्या भयो।"
    });
  }
});
// Admin: सबै अर्डर हेर्ने
app.get("/api/orders", (req, res) => {
  const orders = db.prepare("SELECT * FROM orders ORDER BY id DESC").all();
  res.json(orders);
});

// Admin: अर्डरको Status परिवर्तन गर्ने
app.patch("/api/orders/:id/status", (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["Pending", "Confirmed", "Delivered"];

    if (!allowed.includes(status)) {
      return res.status(400).json({
        message: "गलत Status!"
      });
    }

    const result = db.prepare(
      "UPDATE orders SET status = ? WHERE id = ?"
    ).run(status, Number(req.params.id));

    if (result.changes === 0) {
      return res.status(404).json({
        message: "Order not found."
      });
    }

    res.json({
      message: "Status changed.",
      status: status
    });

  } catch (error) {
    console.error("Status update error:", error);
    res.status(500).json({
      message: "Status update failed."
    });
  }
});
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Hamro Click & Collect running on port " + PORT);
});
