require("dotenv").config();
const express = require("express");
const cors = require("cors");
const truckRoutes = require('./routes/truckRoutes.js');

const app = express();
const port = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());


app.get('/truck-suggest-api', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'truck-suggestion-api',
    node_version: process.version
  });
});


app.use("/api", truckRoutes);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});




