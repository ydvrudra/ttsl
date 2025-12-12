const axios = require('axios');
const { pool, poolConnect, sql } = require('../config/sqlConfig');


exports.fetchExchangeRates = async (req, res) => {
  try {
    await poolConnect;

    const limit = parseInt(req.query.limit) || 999;
    const response = await axios.get("https://api.exchangerate-api.com/v4/latest/USD");
    const { base, rates } = response.data;

    const limitedRates = Object.entries(rates).slice(0, limit);

    for (let [toCurrency, rate] of limitedRates) {
      // USD to Other
      await pool.request()
        .input('FromCurrency', sql.VarChar(3), base)
        .input('ToCurrency', sql.VarChar(3), toCurrency)
        .input('Rate', sql.Float, rate)
        .query(`
          INSERT INTO ExchangeRates (FromCurrency, ToCurrency, Rate, UpdatedAt)
          VALUES (@FromCurrency, @ToCurrency, @Rate, GETDATE())
        `);

      // Other to USD
      if (rate !== 0) {
        await pool.request()
          .input('FromCurrency', sql.VarChar(3), toCurrency)
          .input('ToCurrency', sql.VarChar(3), base)
          .input('Rate', sql.Float, 1 / rate)
          .query(`
            INSERT INTO ExchangeRates (FromCurrency, ToCurrency, Rate, UpdatedAt)
            VALUES (@FromCurrency, @ToCurrency, @Rate, GETDATE())
          `);
      }
    }

    res.status(200).json({ message: `${limit} exchange rates inserted successfully.` });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ message: 'Error fetching exchange rates', error: error.message });
  }
};