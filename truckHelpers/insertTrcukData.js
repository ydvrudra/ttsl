// services/insertService.js
const { sql, pool, poolConnect } = require('../config/sqlConfig');
const { AppError, ErrorTypes } = require('../utils/errorHandler');

class InsertService {
    
    // ✅ 1. Insert API response into table
    async insertResponseToTable(recordId, apiResponse) {
        try {
            await poolConnect;
            
            // Validate response
            if (!apiResponse.options || !Array.isArray(apiResponse.options)) {
                console.log(`📭 No options to insert for record ${recordId}`);
                return { success: false, message: 'No options in response' };
            }
            
            // Delete old options
            await this.deleteOldOptions(recordId);
            
            // Insert each option
            let insertedCount = 0;
            for (const option of apiResponse.options) {
                await this.insertSingleOption(recordId, option);
                insertedCount++;
            }
            
            console.log(`✅ Inserted ${insertedCount} options for record ${recordId}`);
            return { success: true, inserted: insertedCount };
            
        } catch (error) {
            console.error(`❌ Error inserting API response:`, error);
            throw new AppError(
                ErrorTypes.DATABASE.QUERY_FAILED,
                `Failed to insert options for record ${recordId}: ${error.message}`
            );
        }
    }
    
    // ✅ 2. Delete old options
    async deleteOldOptions(recordId) {
        try {
            await pool.request()
                .input('recordId', sql.Int, recordId)
                .query(`
                    DELETE FROM EnquiryVehicleQuotationOption
                    WHERE EnquiryDimensionsHdrId = @recordId
                `);
        } catch (error) {
            console.warn(`⚠️ Could not delete old options for ${recordId}:`, error.message);
            // Don't throw, continue with insert
        }
    }
    
    // ✅ 3. Insert single option
    async insertSingleOption(recordId, option) {
        const request = pool.request();
        
        const truckDetails = this.formatTruckDetails(option.allocations);
        const suggestedTruckIds = this.extractTruckIds(option.allocations);
        const totalCBM = this.calculateTotalCBM(option.allocations);
        const totalWeight = this.calculateTotalWeight(option.allocations);
        const rates = `Rs. ${(option.totalCost || 0).toLocaleString('en-IN')}`;
        
        const query = `
            INSERT INTO EnquiryVehicleQuotationOption (
                EnquiryDimensionsHdrId,
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
    
    // ✅ 4. Format truck details
    formatTruckDetails(allocations) {
        if (!allocations) return 'From API Response';
        
        return allocations.map(alloc => {
            const parts = [];
            if (alloc.qtyItems) parts.push(`${alloc.qtyItems}pkgs`);
            if (alloc.usedCBM) parts.push(`${alloc.usedCBM.toFixed(2)}CBM`);
            if (alloc.usedWeightKg) parts.push(`${alloc.usedWeightKg}kg`);
            
            return `${alloc.truckName} (${parts.join('/')})`;
        }).join(', ');
    }
    
    // ✅ 5. Extract truck IDs
    extractTruckIds(allocations) {
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
    
    // ✅ 6. Calculate total CBM
    calculateTotalCBM(allocations) {
        if (!allocations) return '0 (0)';
        
        const total = allocations.reduce((sum, alloc) => sum + (alloc.usedCBM || 0), 0);
        const perTruck = allocations.length > 0 ? total / allocations.length : 0;
        
        return `${total.toFixed(2)} (${perTruck.toFixed(2)})`;
    }
    
    // ✅ 7. Calculate total weight
    calculateTotalWeight(allocations) {
        if (!allocations) return '0 (0)';
        
        const total = allocations.reduce((sum, alloc) => sum + (alloc.usedWeightKg || 0), 0);
        const perTruck = allocations.length > 0 ? total / allocations.length : 0;
        
        return `${total} (${perTruck})`;
    }
    
    // ✅ 8. Update main table with truck IDs
    async updateMainTable(recordId, allocations) {
        try {
            if (!recordId || !allocations || !Array.isArray(allocations)) {
                return;
            }
            
            let repeatedTruckIds = [];
            allocations.forEach(alloc => {
                for (let i = 0; i < (alloc.truckCount || 1); i++) {
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
            
            await pool.request()
                .input('truckIds', sql.VarChar, truckIds)
                .input('suggestionsJson', sql.NVarChar, JSON.stringify(allocations))
                .input('recordId', sql.Int, recordId)
                .query(updateQuery);
            
            console.log(`✅ Main table updated for record: ${recordId}`);
            
        } catch (error) {
            console.warn(`⚠️ Could not update main table for ${recordId}:`, error.message);
            // Don't throw, this is non-critical
        }
    }
}

module.exports = new InsertService();