require("dotenv").config();
const express = require("express");
const cors = require("cors");
const truckRoutes = require('./routes/truckRoutes.js');

const app = express();
const port = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());


app.post('/truck-suggest-api', (req, res) => {
  res.json({ 
    message: 'POST request received',
    timestamp: new Date().toISOString(),
    data: req.body
  });
});


app.use("/api", truckRoutes);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
   console.log(`📡 API: http://localhost:${port}/api/truck/suggest`);
});




