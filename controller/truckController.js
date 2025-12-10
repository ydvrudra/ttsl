// controllers/truckController.js
const { sql, pool, poolConnect } = require('../config/sqlConfig');
const { loadHeaderAndPackages, loadVehiclesAndCapacities } = require('../truckHelpers/loadData');
const { allocateTrucksAndPrice } = require('../truckHelpers/truckAllocation');

async function suggestTruckForEnquiry(req, res) {
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
    // --- 1) Load header & packages ---
    const { hdr, pkgs } = await loadHeaderAndPackages(client, recordId, bodyPackages, calculationUnitId);

    if (!pkgs.length) {
      return res.status(200).json({ status: 'no-packages', message: 'No packages found' });
    }
    // --- 2) Load vehicles & capacities ---
    const vehicles = await loadVehiclesAndCapacities(client);

    if (!vehicles.length) {
      return res.status(500).json({ status: 'no-vehicles', message: 'No truck types found' });
    }
    // --- 3) Allocate trucks & calculate charges ---
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

    // Line ~55 ke around UPDATE query fix karo:
if (recordId && result.status === 'success') {
  try {
    let repeatedTruckIds = [];
    
    result.allocations.forEach(alloc => {
      for (let i = 0; i < alloc.truckCount; i++) {
        repeatedTruckIds.push(alloc.truckId);
      }
    });
    
    const truckIds = repeatedTruckIds.join(',');
    
    // ✅ CORRECT UPDATE QUERY:
    const updateQuery = `
      UPDATE EnquiryGenerationNew 
      SET VehicleTypeMasterId = @truckIds,
          SuggestOneVehicle = @suggestionsJson
      WHERE EnquiryGenerationNewId = @recordId
    `;
    
    // ✅ sql variable use karo:
    await pool.request()
      .input('truckIds', sql.VarChar, truckIds)
      .input('suggestionsJson', sql.NVarChar, JSON.stringify(result.allocations))
      .input('recordId', sql.Int, recordId)
      .query(updateQuery);
      
    console.log('✅ Database updated successfully for record:', recordId);
      
  } catch (updateError) {
    // ⚠️ ERROR LOG KARO:
    console.error('❌ UPDATE ERROR:', updateError.message);
    console.error('Record ID:', recordId);
  }
}

    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({ error: 'Internal error', details: err.message });
  }
}

module.exports = { suggestTruckForEnquiry };
