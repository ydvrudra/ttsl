require("dotenv").config();
const express = require("express");
const cors = require("cors");
const truckRoutes = require('./routes/truckRoutes.js');

const app = express();
const port = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());

app.use("/api", truckRoutes);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});




