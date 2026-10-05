Utilities implementation contract draft — not integrated

Clinical/culture are frozen. Core owner is holding new APIs/import/10th manifest for the current coherent checkpoint. This plan has no production effect, no utility income, and no user-facing buttons.

Core contracts
- utilityMeter(minutes) is pure: at/minutes/energyFraction/waterFraction/maintenanceFraction, household actor/home/district energy and water units, business shop/site/district energy units, publicEnergyUnits. Units are the existing demand-point×game-minute and pump/quality-weighted supply-minute, not kWh or litres.
- publicDecisionWitness(actorId,siteId) yields an actual duty/role/floor/position/time witness or null. Tariff deliberation is at least1440 monotonic minutes; NPC approval requires treasury and distinct actual governance sites, or an elected player mayor at the decision floor.
- collectUtilityPayment takes payerKind actor/shop, payerId, requested, billId, siteId and returns actual paid. It protects accrued and committed wages, public account capacity, emits utility-payment and records public income once.
- consumeUtilitySupplies(sim,q) returns true finite previously paid welfare inventory lots. Core consumes those before buying missing operating materials and emits municipal-operation-fulfilled. New credit can arise only from actually fulfilled material consumption, and may only offset the current basic bill.
- Core installs the module after family/culture and adds the next explicit manifest body. An approved, public effective energy tariff replaces the old business flat utility cost; otherwise legacy behavior remains.

Commands reserved with city
fileUtilityProposal(targetId energy/water,value household rate,utilityBusinessRate optional,title,text); reviewUtilityProposal(proposalId); payUtilityBill(billId,value requested); fundUtilityRelief(approved proposalId,value authorized cap). No default household collection before published approval. Payment is made at an actual public bank/governance counter.

Proposed persistent schema
UtilitiesState: version, nextProposalId, nextBillId, nextReliefId, proposals, activeTariffs, currentPeriod, accounts, bills, payments, reliefOrders, pendingFulfillment, stats.
UtilityProposal: id,authorId,kind,householdRate,businessRate,title,text,filedAt,reviewAt,approvedAt,publishedAt,effectiveAt,status,witnesses,lastReason. Approved rates become effective at a published future day boundary; current-period rates do not change retrospectively.
UtilityWitness: actorId,role,siteId,facility,floor,position,at. Store actual historical witness snapshots and verify distinct eligible departments, sites, and identities.
UtilityPeriod: day,startAt,lastReadingAt,rows by actor/shop key with actual units, rate/proposal references, gross and allocated current basic credit. Split a tick crossing midnight proportionately; clock jumps never create missed historical usage.
UtilityAccount: payerKind,payerId,homeId/siteId,districtId,totalIssued,totalCredits,totalPaid,totalWrittenOff,archivedPrincipalDue,archivedTotals,closedAt. Issued receivables are claims and are never counted as physical cash.
UtilityBill: id,accountKey,day,fromAt,toAt,energyUnits,waterUnits,rate snapshots,proposal references,gross,basicCredit,paid,principalDue. Paid and older unpaid bills can be archived into immutable account totals and outstanding principal without deleting debt.
UtilityPayment: id,billId/accountKey,actual payer kind/id,amount,at,siteId,sourceEvent. Player sponsorship of a child bill must debit the actual adult payer, not mint or silently charge the child.
UtilityReliefOrder: id,proposalId,siteId,purpose utilities-basic,cap,approvedAt,approvedBy,spent,receivedUnits,consumedUnits,targetUnits,receipts,lots,retryAt,closedAt,lastReason. Each lot keeps budgetId,procurementId,quantity,remaining,unitPrice. Procurement and actual core operation consumption must cross-check both directions against budget and stock.

Behavior and validation
- No initially added cash, waived old principal or duplicated maintenance purchase.
- NPC ordinances and payments require actual travel, staffing, floor permission and elapsed time. Poor payers retain a food reserve; any actual short payment remains a municipal receivable.
- Finite quotas and bounded recent queues; archived account balances preserve cumulative issued/credit/payment/receivable equality.
- On death stop new measurements, crystallize already measured usage, and preserve outstanding claims for the estate executor. Bank claims and utilities must have an explicit priority; a pending share/business liquidation must not be declared a municipal loss early, and excess debt must not be imposed on a child. Root-owned family integration will need an exact settleDeceasedUtilities result before wallet inheritance.
- Cash audit includes only core-collected payments; procurement remains treasury→supplier net+tax; credits change receivables, not cash.
- Dynamic registered resident references, day consistency, rate/approval snapshots, stock/receipt/budget/consumption equalities, bad-file atomic rejection, module presence, and exact save/load continuation.

Tests to implement after core unfreeze
No-fee default; actual legal witnesses and1440-minute delay; real household/shop meter and day split; immutable approved rates; partial actual payment, food/wage reserve and old arrears; finite paid welfare stock consumed once, fulfillment-based basic credit only, no repeated procurement; payer death/estate priority; new citizen refs; old pre-body migration and manifest rejection; malformed references/timers/rates/stock/budget/payments; exact24-tick restored continuation and real player UI lifecycle.
