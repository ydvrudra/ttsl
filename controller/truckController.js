// controllers/truckController.js
const { sql, pool, poolConnect } = require('../config/sqlConfig'); // ✅ sql import
const { loadHeaderAndPackages, loadVehiclesAndCapacities } = require('../truckHelpers/loadData');
const { allocateTrucksAndPrice } = require('../truckHelpers/truckAllocation');

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

    return res.status(200).json(result);

  } catch (err) {
    console.error('❌ MAIN ERROR in truckController:', err);
    return res.status(500).json({ error: 'Internal error', details: err.message });
  }
}

module.exports = { suggestTruckForEnquiry };