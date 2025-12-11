// controllers/truckController.js
const { sql, pool, poolConnect } = require('../config/sqlConfig'); // ✅ sql import
const { loadHeaderAndPackages, loadVehiclesAndCapacities } = require('../truckHelpers/loadData');
const { allocateTrucksAndPrice } = require('../truckHelpers/truckAllocation');

// ✅ NEW: Insert API response into table
async function insertResponseToTable(recordId, apiResponse) {
    try {
        await poolConnect;
        
        // Check if response has options
        if (!apiResponse.options || !Array.isArray(apiResponse.options)) {
            console.log(`No options to insert for record ${recordId}`);
            return;
        }
        
        // Delete old options if any
        await pool.request()
            .input('recordId', sql.Int, recordId)
            .query(`
                DELETE FROM EnquiryVehicleQuotationOption
                WHERE EnquiryGenerationNewId = @recordId
            `);
        
        // Insert each option
        for (const option of apiResponse.options) {
            await insertSingleOption(recordId, option);
        }
        
        console.log(`✅ Inserted ${apiResponse.options.length} options for record ${recordId}`);
        
    } catch (error) {
        console.error(`❌ Error inserting API response:`, error);
    }
}

// ✅ Helper: Insert single option
async function insertSingleOption(recordId, option) {
    const request = pool.request();
    
    // Format data exactly like your example
    const query = `
        INSERT INTO EnquiryVehicleQuotationOption (
            EnquiryGenerationNewId,
            OptionName,
            TruckDetails,
            TotalTrucks,
            TotalPackages,
            TotalCBM,
            TotalWeight,
            Rates,
            Currency,
            TotalCostInINR,
            TotalCostInUSD,
            SuggestedTruckIds,
            kz_CreatedUserId,
            kz_ModifiedDateTime
        ) VALUES (
            @recordId,
            @optionName,
            @truckDetails,
            @totalTrucks,
            @totalPackages,
            @totalCBM,
            @totalWeight,
            @rates,
            @currency,
            @totalCostInINR,
            @totalCostInUSD,
            @suggestedTruckIds,
            @userId,
            GETDATE()
        )
    `;
    
    // Calculate values
    const truckDetails = formatTruckDetails(option.allocations);
    const suggestedTruckIds = extractTruckIds(option.allocations);
    const totalCBM = calculateTotalCBM(option.allocations);
    const totalWeight = calculateTotalWeight(option.allocations);
    const rates = `Rs. ${(option.totalCost || 0).toLocaleString('en-IN')}`;
    
    await request
        .input('recordId', sql.Int, recordId)
        .input('optionName', sql.VarChar, option.optionName || 'API Option')
        .input('truckDetails', sql.VarChar, truckDetails)
        .input('totalTrucks', sql.Int, option.totalTrucks || 1)
        .input('totalPackages', sql.Int, option.totalPackages || 0)
        .input('totalCBM', sql.VarChar, totalCBM)
        .input('totalWeight', sql.VarChar, totalWeight)
        .input('rates', sql.VarChar, rates)
        .input('currency', sql.VarChar, option.currency || 'INR')
        .input('totalCostInINR', sql.Numeric(18, 2), option.totalCost || 0)
        .input('totalCostInUSD', sql.Numeric(18, 2), option.totalCost || 0)
        .input('suggestedTruckIds', sql.VarChar, suggestedTruckIds)
        .input('userId', sql.Int, 3)
        .query(query);
}

// ✅ Helper functions
function formatTruckDetails(allocations) {
    if (!allocations) return 'From API Response';
    
    return allocations.map(alloc => {
        const parts = [];
        if (alloc.qtyItems) parts.push(`${alloc.qtyItems}pkgs`);
        if (alloc.usedCBM) parts.push(`${alloc.usedCBM.toFixed(2)}CBM`);
        if (alloc.usedWeightKg) parts.push(`${alloc.usedWeightKg}kg`);
        
        return `${alloc.truckName} (${parts.join('/')})`;
    }).join(', ');
}

function extractTruckIds(allocations) {
    if (!allocations) return '';
    
    const ids = [];
    allocations.forEach(alloc => {
        const count = alloc.truckCount || 1;
        for (let i = 0; i < count; i++) {
            ids.push(alloc.truckId);
        }
    });
    
    return [...new Set(ids)].join(',');
}

function calculateTotalCBM(allocations) {
    if (!allocations) return '0 (0)';
    
    const total = allocations.reduce((sum, alloc) => sum + (alloc.usedCBM || 0), 0);
    const perTruck = allocations.length > 0 ? total / allocations.length : 0;
    
    return `${total.toFixed(2)} (${perTruck.toFixed(2)})`;
}

function calculateTotalWeight(allocations) {
    if (!allocations) return '0 (0)';
    
    const total = allocations.reduce((sum, alloc) => sum + (alloc.usedWeightKg || 0), 0);
    const perTruck = allocations.length > 0 ? total / allocations.length : 0;
    
    return `${total} (${perTruck})`;
}

async function suggestTruckForEnquiry(req, res) {

   res.setTimeout(120000, () => { // 120 seconds timeout
    console.log('⚠️ Request timeout after 120 seconds');
    return res.status(504).json({ 
      error: 'Gateway Timeout', 
      message: 'Request took too long to process' 
    });
  });

  await poolConnect;
  const client = pool;
  const { 
    recordId, 
    packages: bodyPackages = [], 
    userId = 0, 
    persist = false,
    calculationUnitId,
    fromLocationId,
    toLocationId,
    companyId,
    segmentId
  } = req.body || {};

  try {
    const { hdr, pkgs } = await loadHeaderAndPackages(client, recordId, bodyPackages, calculationUnitId);

    if (!pkgs.length) {
      return res.status(200).json({ status: 'no-packages', message: 'No packages found' });
    }
    
    const vehicles = await loadVehiclesAndCapacities(client);

    if (!vehicles.length) {
      return res.status(500).json({ status: 'no-vehicles', message: 'No truck types found' });
    }
    
    const result = await allocateTrucksAndPrice({
      client,
      hdr,
      pkgs,
      vehicles,
      persist,
      recordId,
      userId,
      fromLocationId,
      toLocationId,
      companyId,
      segmentId
    });

    // ✅ DATABASE UPDATE
    if (recordId && result.status === 'success' && result.allocations) {
      try {
        let repeatedTruckIds = [];
        
        result.allocations.forEach(alloc => {
          for (let i = 0; i < alloc.truckCount; i++) {
            repeatedTruckIds.push(alloc.truckId);
          }
        });
        
        const truckIds = repeatedTruckIds.join(',');
        
        const updateQuery = `
          UPDATE EnquiryGenerationNew 
          SET VehicleTypeMasterId = @truckIds,
              SuggestOneVehicle = @suggestionsJson
          WHERE EnquiryGenerationNewId = @recordId
        `;
        
        // ✅ FIXED: Use sql variable
        await pool.request()
          .input('truckIds', sql.VarChar, truckIds)
          .input('suggestionsJson', sql.NVarChar, JSON.stringify(result.allocations))
          .input('recordId', sql.Int, recordId)
          .query(updateQuery);
          
        console.log('✅ Database updated for record:', recordId);
          
      } catch (updateError) {
        // ✅ ERROR LOGGING
        console.error('❌ UPDATE ERROR in truckController:');
        console.error('Error:', updateError.message);
        console.error('Stack:', updateError.stack);
        console.error('Record ID:', recordId);
      }
    }

    console.log('API called with recordId:', recordId);
    console.log('Response status:', result.status);

    // ✅ NEW: INSERT API RESPONSE TO TABLE
    if (recordId && result.status === 'success') {
      console.log('Calling insertResponseToTable for record:', recordId);
      await insertResponseToTable(recordId, result);
    }

    return res.status(200).json(result);

  } catch (err) {
    console.error('❌ MAIN ERROR in truckController:', err);
    return res.status(500).json({ error: 'Internal error', details: err.message });
  }
}

module.exports = { suggestTruckForEnquiry };