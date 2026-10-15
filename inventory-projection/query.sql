'OH HAND'

select top(100) * 
from [Inventory_Enh_History].[ItemBalance]
where CAST(DateWeekEnding AS DATE) = (
    select max(CAST(DateWeekEnding AS DATE)) from [Inventory_Enh_History].[ItemBalance]
)
and ItemNumber = 'EB1460-231'




SELECT top(100) * from SupplyChain_Enh.DemandInventorySnapshot
where CAST(dinSnapShot AS DATE) = (
    select max(CAST(dinSnapShot AS DATE)) from SupplyChain_Enh.DemandInventorySnapshot
)
and dinItem = 'EB1460-231'



select top(100) * 
from SupplyChain_DW.FactDemand
where CAST([Year Period] AS DATE) = '2026-06-11'
  and Item = 'EB1460-231'


where CAST((Year Period) AS DATE) = (
    select max(CAST((Year Period) AS DATE)) from SupplyChain_Enh.DemandInventorySnapshot)



select top(100) * from AFISales_DW.DimItemMaster

'PDT'
select top(100) * from Wholesale_DemandPlanning_AFI.SupplyPlanDetail
where spdWarehouse = "All"



select top(100) * from AFISales_DW.DimItemMaster
where CAST(MarketEndDate AS DATE) = (
    select max(CAST(MarketEndDate AS DATE)) from AFISales_DW.DimItemMaster




'PROD'

select top(100) * from SupplyChain_Enh.ProductionConversion

'Item Info'
select top(100) * from [PowerBI_SupplyChain].[CurrentProductDetails]




    SELECT
        PDT.[spdItem] AS [ItemNumber],
        PDT.[spdWarehouse] AS [Warehouse],
        PDT.[spdFirmDemands] AS [FirmDemands],
        PDT.[spdNetForecast] AS [NetForecast],
        PDT.[spdFirmPurchaseOrders] AS [FirmPurchaseOrders],
        PDT.[spdPlannedPurchaseOrders] AS [PlannedPurchaseOrders],
        PDT.[spdShippableInventory] AS [ShippableInventory],
        PDT.[spdSafetyStock] AS [SafetyStock],
        CAST(PDT.[dtec] AS date) AS [SnapshotDate],
        CAST(PDT.[spdWeekEnding] AS date) AS [DateWeekEnding],
        info.[Collective Class] AS [CollectiveClass],
        info.[AFI Finance Division] AS [AFIFinanceDivision],
        info.[Primary Vendor] AS [PrimaryVendor],    
        info.[Current Status] AS [CurrentStatus],
        info.[Future Status] AS [FutureStatus],    
        info.[Hold Buy Code] AS [HoldBuyCode]
    FROM [Wholesale_DemandPlanning_AFI].[SupplyPlanDetail] PDT    
    LEFT JOIN [PowerBI_SupplyChain].[CurrentProductDetails] info 
        ON info.[Item SKU] = PDT.[spdItem]
    WHERE info.[Primary Vendor] IN ('624556', '600039', '900515', '900639')
    AND PDT.[spdWarehouse] IN ('1', '15', '17', '28', '335', '5', 'ECR')
    AND CAST(PDT.[dtec] AS date) = (
        SELECT MAX(CAST([dtec] AS date)) 
        FROM [Wholesale_DemandPlanning_AFI].[SupplyPlanDetail]
    )
    AND CAST(PDT.[spdWeekEnding] AS date) = (
        SELECT MAX(CAST([spdWeekEnding] AS date)) 
        FROM [Wholesale_DemandPlanning_AFI].[SupplyPlanDetail] 
        WHERE CAST([dtec] AS date) = (
            SELECT MAX(CAST([dtec] AS date)) 
            FROM [Wholesale_DemandPlanning_AFI].[SupplyPlanDetail]
        )
    )
    ORDER BY [DateWeekEnding], [ItemNumber]


'PO MASTER'
WITH PO_Summary AS (
    SELECT	
        pomordernum AS PO,
        CAST(pomcreated AS DATE) AS POCreateDate,
        CAST(pomoriginaletd AS DATE) AS OriginalETD,
        pomPOClass AS POType,
        pomvendornum AS Vendor,
        CAST(pometd AS DATE) AS ETD,
        CAST(pometa AS DATE) AS ETA,
        DATEADD(DAY, 7 - DATEPART(WEEKDAY, CAST(pometa AS DATE)), CAST(pometa AS DATE)) AS ETA_Week,   
        pomwarehouse AS Whse,
        pomstatuscode AS PO_Status,
        pomOrigCntrSize AS Mode
    FROM [Wholesale_ProductSourcing_AFI].[PoMaster]
    WHERE pomvendornum IN ('624556','600039','900515','900639')
      AND pomwarehouse IN ('335','1','ECR','15','17','28','5')
)

SELECT
    ps.PO,
    ps.POCreateDate,
    ps.OriginalETD,
    ps.POType,
    ps.Vendor,
    ps.ETD,
    ps.ETA,
    ps.ETA_Week,
    ps.Whse,
    ps.Mode,
    pd.poditemnum AS Item,
    pd.podqtyordered AS QtyOrdered,
    pd.poditemclass AS ITCLS
FROM PO_Summary ps
LEFT JOIN [Wholesale_ProductSourcing_AFI].[PoDetail] pd
    ON ps.PO = pd.podordernum


'actual transfer load time'
SELECT *
FROM [SupplyChain_Enh].[TransferLoadTotAvgTimeAnalysisReport]



'PO MASTER'

    select top(100) * from [Wholesale_ProductSourcing_AFI].[PoMaster]
where pomordernum = 'P2VVR76'

pomSubmitToTreasury


'SOURCE DATA'

select
IB.ItemNumber as Item_number,
IB.Warehouse,
cast(sum(IB.OnhandQty) as Int) as [Onhand],
IB.DateWeekEnding as dtec,
PD.[Cubes],
CASE
            WHEN PD.[Product Line] IN ('Accessories', 'Bedroom', 'Bedding', 'Dining', 'Entertainment', 'Home Office', 'Occasional', 'Outdoor', 'Other') THEN 'CG'
            WHEN PD.[Product Line] IN ('Motion', 'Stationary') THEN 'UPH'
            ELSE 'RP'
        END AS Prod_Type
from Inventory_Enh_History.ItemBalance IB
LEFT JOIN [PowerBI_SupplyChain].[CurrentProductDetails] PD ON IB.ItemNumber = PD.[Item SKU]
LEFT JOIN [Enterprise_DW].[DimDate]
ON cast(IB.DateWeekEnding as Date) = cast(DateID as Date)
where Warehouse = '335'
and CalendarWeekIndicator between -10 and  0
and PD.[Product Line] is not NUll
    AND CAST(IB.DateWeekEnding AS DATE) = (
        SELECT MAX(CAST(DateWeekEnding AS DATE))
        FROM Inventory_Enh_History.ItemBalance
        WHERE Warehouse = '335'
    )
group by IB.ItemNumber,
IB.Warehouse,
IB.DateWeekEnding,
PD.[Cubes],
CASE
            WHEN PD.[Product Line] IN ('Accessories', 'Bedroom', 'Bedding', 'Dining', 'Entertainment', 'Home Office', 'Occasional', 'Outdoor', 'Other') THEN 'CG'
            WHEN PD.[Product Line] IN ('Motion', 'Stationary') THEN 'UPH'
            ELSE 'RP'
        END




'PDT VER 2'

SELECT 
        spd.spdItem,
        spd.spdWarehouse,
        spd.spdWeekEnding,
        DATEDIFF(WEEK, spd.dtea, spd.spdWeekEnding) + 1 AS weeknum,
        spd.spdBeginingBalance,
        spd.spdFirmDemands,
        spd.spdNetForecast,
        spd.spdFirmTransferOut,
        spd.spdFirmProduction,
        spd.spdFirmPurchaseOrders,
        spd.spdInTransitTransferIn,
        spd.spdOnOrderTransferIn,
        spd.spdPlannedTransferIn,
        spd.spdPlannedTransferOut,
        spd.spdPlannedProduction,
        spd.spdPlannedPurchaseOrders,
        spd.spdSafetyStock,
        spd.spdShippableInventory,
        spd.spdShippableInventory - spd.spdSafetyStock AS SISS,
        spd.spdPromotionalLift,
        spd.spdDemandFulfillment,
        planningvendor.[Planning Vendor],
        CONVERT(VARCHAR(10), spd.dtea, 101) AS SnapShotDate
    FROM Wholesale_DemandPlanning_AFI.SupplyPlanDetail AS spd 
    LEFT JOIN PowerBI_SupplyChain.ITPItemMaster AS itp
        ON spd.spditem = itp.[Item SKU]
    LEFT JOIN (
        SELECT DISTINCT [Item-Lvl1], [Planning Vendor], [FileDate]
        FROM [PowerBI_SupplyChain].[ForecastCommonContainer_Logility]
        WHERE [FileDate] = CAST(
            CASE
                WHEN DATEPART(dw, GETDATE() - 1) = 1 THEN GETDATE() - 2
                ELSE GETDATE() - 1
            END AS DATE)
        AND [Planning Vendor] <> ''
    ) AS planningvendor
        ON spd.spdItem = planningvendor.[Item-Lvl1]
    WHERE
        DATEDIFF(WEEK, spd.dtea, spd.spdWeekEnding) + 1 < 23
        AND spd.spdWarehouse IN ('1','15','17','28','335','42','5','ECR')
        AND itp.[item type] NOT IN ('bed kit','component','rp','sw','un kit')
        AND (
    --Monday and latest day of week 0
    DATEDIFF(DAY, spd.dtea, GETDATE()) = (SELECT MIN(DATEDIFF(DAY, spd.dtea, GETDATE()))
    FROM Wholesale_DemandPlanning_AFI.SupplyPlanDetail as spd)
    OR
    (DATEDIFF(WEEK, spd.dtea, GETDATE()) = 0 AND DATEPART(dw, spd.dtea) = 2)
    OR
    --Mon and Fri of week -1
    (DATEDIFF(WEEK, spd.dtea, GETDATE()) = 1 AND (DATEPART(dw, spd.dtea) = 2 OR DATEPART(dw, spd.dtea) = 6))
    OR
    --Mon of week -2
    (DATEDIFF(WEEK, spd.dtea, GETDATE()) = 2 AND DATEPART(dw, spd.dtea) = 2)
    OR
    --Mon of week -3
    (DATEDIFF(WEEK, spd.dtea, GETDATE()) = 3 AND DATEPART(dw, spd.dtea) = 2)
    OR
    --Mon of week -4
    (DATEDIFF(WEEK, spd.dtea, GETDATE()) = 4 AND DATEPART(dw, spd.dtea) = 2)
    OR 
    --Mon of week -8
    (DATEDIFF(WEEK, spd.dtea, GETDATE()) = 8 AND DATEPART(dw, spd.dtea) = 2)
    )




SELECT
    PDT.[spdItem] AS [Item #],
    PDT.[spdWarehouse] AS Whse,
    PDT.[spdBeginingBalance],
    PDT.[spdFirmDemands] AS [FIRM DEMANDS],
    PDT.[spdNetForecast] AS [NET FCST],
    PDT.[spdFirmProduction] AS[FIRM PROD],
    PDT.[spdInTransitTransferIn] AS [INTRANSIT TRF IN],
    PDT.[spdOnOrderTransferIn] AS [ON ORDER TRF IN],
    PDT.[spdPlannedTransferIn] AS [PLANNED TRF IN],
    PDT.[spdPlannedTransferOut] AS [PLANNED TRF OUT],
    PDT.[spdPlannedProduction] AS [PLANNED PROD],
    PDT.[spdFirmPurchaseOrders] AS [FIRM POS],
    PDT.[spdPlannedPurchaseOrders] AS [PLANNED POS],
    PDT.[spdFirmTransferOut] AS [FIRM TRF OUT],
    PDT.[spdPromotionalLift]. AS [PROMOTIONAL LIFT], 
    PDT.[spdShippableInventory] AS [SHIPPABLE INV],
    PDT.[spdSafetyStock] AS [SAFETY STK],
    CAST(PDT.[dtec] AS date) AS [Snapshot Date],
    PDT.[spdWeekEnding] AS [Due Date],
    info.[Collective Class],
    info.[AFI Finance Division],
    info.[Primary Vendor],    
    info.[Current Status],
    info.[Future Status],    
    info.[Hold Buy Code] AS HB
FROM [Wholesale_DemandPlanning_AFI].[SupplyPlanDetail] PDT    
LEFT JOIN [PowerBI_SupplyChain].[CurrentProductDetails] info 
    ON info.[Item SKU] = PDT.[spdItem]
WHERE info.[Primary Vendor] in ('600039', '900515', '900639', '624556')
  AND PDT.[spdWarehouse] IN ('1', '15', '17', '28', '335', '5', 'ECR')
  AND CAST(PDT.[dtec] AS date) = (
      SELECT MAX(CAST([dtec] AS date)) 
      FROM [Wholesale_DemandPlanning_AFI].[SupplyPlanDetail]
  )
ORDER BY PDT.[spdWeekEnding], PDT.[spdItem]    



'Dual Source'

select top(100) * from SupplyChain_Enh.VendorSplits

select top(100) * from [Wholesale_DemandPlanning_AFI].[SupplyPlanDetail]
where spdItem = 'U1370015A'

select top(100) * from [Wholesale_ProductSourcing_AFI].[PoDetail] pd
where poditemnum = 'U1370015A'


select top(100) * from [Wholesale_ProductSourcing_AFI].[PoMaster] pom
where pomordernum = 'P2VVR76'


select top(100) * from [Wholesale_ProductSourcing_AFI].[PoDetail] pd
where podordernum = 'P2VVR76'


'Unconstraint demand'

select count(distinct dtea) as DistinctDtecCount
from [Wholesale_DemandPlanning_AFI].[UnconstrainedPlannedRequirements]

select * from [Wholesale_DemandPlanning_AFI].[UnconstrainedPlannedRequirements]



select top(100) * from SupplyChain_DW.FactDemand



---AFT SI SS---
DECLARE @maxdate AS DATE;
SET @maxdate =
(
    SELECT MAX(CAST(SPRunDate AS DATE))
    FROM SupplyChain_Enh.PSWWeeklyExtractSnapshot
);

DECLARE @maxdatefirm AS DATE;
SET @maxdatefirm =
(
    SELECT MAX(CAST(dtea AS DATE))
    FROM Wholesale_DemandPlanning_AFI.SupplyPlanDetail
);
SELECT *,
       concat([ITNBR], ':', [WHSE]) AS [KEY],
       CASE
           WHEN [TYPE] = 'PLANNED' THEN
               2
           WHEN [TYPE] = 'FIRMED' THEN
               1
           WHEN [TYPE] = ('SI-SS')
                AND (SUM([ORDER DUE]) OVER (PARTITION BY ITNBR, WHSE, [DATA TYPE], [DUE DATE])) < 0 THEN
               3
           WHEN [TYPE] = ('SHIPPABLE INV')
                AND (SUM([ORDER DUE]) OVER (PARTITION BY ITNBR, WHSE, [DATA TYPE], [DUE DATE])) < 0 THEN
               3
           WHEN [TYPE] = 'PROMOLIFT QTY'
                AND (SUM([ORDER DUE]) OVER (PARTITION BY ITNBR, WHSE, [DATA TYPE], [DUE DATE])) > 0 THEN
               4
           WHEN [TYPE] = 'PLANNED POS' THEN
               6
           WHEN [TYPE] = 'SHIPPED' THEN
               7
           WHEN [TYPE] = 'FIRM TFR IN' THEN
               8
           WHEN [TYPE] = 'FIRM TFR OUT' THEN
               9
           WHEN [TYPE] = 'PLANNED TFR IN' THEN
               10
           WHEN [TYPE] = 'PLANNED TFR OUT' THEN
               11
       END AS [COLOR DUE WHSE],
       CASE
           WHEN [TYPE] = 'PLANNED' THEN
               2
           WHEN [TYPE] = 'FIRMED' THEN
               1
           WHEN [TYPE] = ('SI-SS')
                AND (SUM([ORDER ETD]) OVER (PARTITION BY ITNBR, WHSE, [DATA TYPE], [NEW ETD WEEKEND])) < 0 THEN
               3
           WHEN [TYPE] = ('SHIPPABLE INV')
                AND (SUM([ORDER ETD]) OVER (PARTITION BY ITNBR, WHSE, [DATA TYPE], [NEW ETD WEEKEND])) < 0 THEN
               3
           WHEN [TYPE] = 'PROMOLIFT QTY'
                AND (SUM([ORDER ETD]) OVER (PARTITION BY ITNBR, WHSE, [DATA TYPE], [NEW ETD WEEKEND])) > 0 THEN
               4
           WHEN [TYPE] = 'PLANNED POS' THEN
               6
           WHEN [TYPE] = 'SHIPPED' THEN
               7
           WHEN [TYPE] = 'FIRM TFR IN' THEN
               8
           WHEN [TYPE] = 'FIRM TFR OUT' THEN
               9
           WHEN [TYPE] = 'PLANNED TFR IN' THEN
               10
           WHEN [TYPE] = 'PLANNED TFR OUT' THEN
               11
       END AS [COLOR ETD WHSE],
       CASE
           WHEN [TYPE] = 'PLANNED' THEN
               2
           WHEN [TYPE] = 'FIRMED' THEN
               1
           WHEN [TYPE] = ('SI-SS')
                AND (SUM([ORDER DUE]) OVER (PARTITION BY ITNBR, [DATA TYPE], [DUE DATE])) < 0 THEN
               3
           WHEN [TYPE] = ('SHIPPABLE INV')
                AND (SUM([ORDER DUE]) OVER (PARTITION BY ITNBR, [DATA TYPE], [DUE DATE])) < 0 THEN
               3
           WHEN [TYPE] = 'PROMOLIFT QTY'
                AND (SUM([ORDER DUE]) OVER (PARTITION BY ITNBR, [DATA TYPE], [DUE DATE])) > 0 THEN
               4
           WHEN [TYPE] = 'PLANNED POS' THEN
               6
           WHEN [TYPE] = 'SHIPPED' THEN
               7
           WHEN [TYPE] = 'FIRM TFR IN' THEN
               8
           WHEN [TYPE] = 'FIRM TFR OUT' THEN
               9
           WHEN [TYPE] = 'PLANNED TFR IN' THEN
               10
           WHEN [TYPE] = 'PLANNED TFR OUT' THEN
               11
       END AS [COLOR DUE],
       CASE
           WHEN [TYPE] = 'PLANNED' THEN
               2
           WHEN [TYPE] = 'FIRMED' THEN
               1
           WHEN [TYPE] = ('SI-SS')
                AND (SUM([ORDER ETD]) OVER (PARTITION BY ITNBR, [DATA TYPE], [NEW ETD WEEKEND])) < 0 THEN
               3
           WHEN [TYPE] = ('SHIPPABLE INV')
                AND (SUM([ORDER ETD]) OVER (PARTITION BY ITNBR, [DATA TYPE], [NEW ETD WEEKEND])) < 0 THEN
               3
           WHEN [TYPE] = 'PROMOLIFT QTY'
                AND (SUM([ORDER ETD]) OVER (PARTITION BY ITNBR, [DATA TYPE], [NEW ETD WEEKEND])) > 0 THEN
               4
           WHEN [TYPE] = 'PLANNED POS' THEN
               6
           WHEN [TYPE] = 'SHIPPED' THEN
               7
           WHEN [TYPE] = 'FIRM TFR IN' THEN
               8
           WHEN [TYPE] = 'FIRM TFR OUT' THEN
               9
           WHEN [TYPE] = 'PLANNED TFR IN' THEN
               10
           WHEN [TYPE] = 'PLANNED TFR OUT' THEN
               11
       END AS [COLOR ETD]
FROM
(
    SELECT *,
           (CASE
                WHEN ROW_NUMBER() OVER (PARTITION BY ITNBR,
                                                     WHSE,
                                                     [DATA TYPE],
                                                     [DUE DATE]
                                        ORDER BY ITNBR,
                                                 WHSE,
                                                 [DATA TYPE],
                                                 [NEW ETD WEEKEND] DESC
                                       ) = 1 THEN
                    [ORDERS FINAL DUE]
                ELSE
                    0
            END
           ) AS [ORDER DUE],
           (CASE
                WHEN ROW_NUMBER() OVER (PARTITION BY ITNBR,
                                                     WHSE,
                                                     [DATA TYPE],
                                                     [NEW ETD WEEKEND]
                                        ORDER BY ITNBR,
                                                 WHSE,
                                                 [DATA TYPE],
                                                 [DUE DATE] DESC
                                       ) = 1 THEN
                    [ORDERS FINAL ETD]
                ELSE
                    0
            END
           ) AS [ORDER ETD]
    FROM
    (
        SELECT *,
               CASE
                   WHEN TYPE IN ( 'SHIPPED' ) THEN
                       SUM([ORDERS]) OVER (PARTITION BY ITNBR, WHSE, [DATA TYPE], [DUE DATE])
                   ELSE
                       [ORDERS]
               END AS [ORDERS FINAL DUE],
               (CASE
                    WHEN TYPE IN ( 'SHIPPED' ) THEN
                        MIN([ORDERS]) OVER (PARTITION BY ITNBR, WHSE, [DATA TYPE], [NEW ETD WEEKEND])
                    ELSE
                        [ORDERS]
                END
               ) AS [ORDERS FINAL ETD]
        FROM
        (
            SELECT DISTINCT
                   [plan].ITNBR,
                   whse.WHSE,
                   CASE
                       WHEN DATATYPE.[DATA TYPE] = 'FIRM POS' THEN
                           FIRM.[TYPE]
                       ELSE
                           DATATYPE.[DATA TYPE]
                   END AS [TYPE],
                   CASE
                       WHEN DATATYPE.[DATA TYPE] IN ( 'FIRMED', 'SHIPPED' ) THEN
                           CONCAT(PSW.[LOCATION], ':', DATATYPE.[DATA TYPE], ':', PSW.[VENDOR NAME])
                       WHEN DATATYPE.[DATA TYPE] = 'FIRM POS' THEN
                           FIRM.[TYPE]
                       ELSE
                           DATATYPE.[DATA TYPE]
                   END AS [DATA TYPE],
                   DT5.[CalendarWeekLastDate] AS [DUE DATE],
                   POF.[ETD Date] AS [ETD DATE],
                   COALESCE(COALESCE(FINALPLAN.ORDERS, PSW.QTY), FIRM.[Orders Firmed]) [ORDERS],
                   vndr1.Delivery AS [DELIVERY],
                   CASE
                       WHEN POF.[ETD Date] IS NULL THEN
                           DATEADD(
                                      DAY,
                                      7 - DATEPART(WEEKDAY, DATEADD(DAY, -vndr1.Delivery, DT5.[CalendarWeekLastDate])),
                                      DATEADD(DAY, -vndr1.Delivery, DT5.[CalendarWeekLastDate])
                                  )
                       ELSE
                           POF.[ETD Date]
                   END AS [NEW ETD WEEKEND]
            FROM
            (
                SELECT DISTINCT
                       PTLITNBR AS ITNBR,
                       CAST(DATEADD(dd, 7 - (DATEPART(dw, GETDATE())), GETDATE()) AS DATE) AS [CURR WeekEnd]
                FROM Wholesale_DemandPlanning_AFI.PlanDetailTimeline
            ) [plan]
                LEFT JOIN
                (
                    SELECT *,
                           CAST(DATEADD(dd, 7 - (DATEPART(dw, GETDATE())), GETDATE()) AS DATE) AS [CURR WeekEnd]
                    FROM Enterprise_DW.DimDate
                    WHERE CalendarWeekIndicator
                    BETWEEN -10 AND 21
                ) DT5
                    ON DT5.[CURR WeekEnd] = [plan].[CURR WeekEnd]
                LEFT JOIN
                (
                    SELECT DISTINCT
                           CASE
                               WHEN PTLDATATYPE = 'KIT COMPT USAGE' THEN
                                   'FIRMED'
                               WHEN PTLDATATYPE = 'NET FCST' THEN
                                   'SHIPPED'
                               WHEN PTLDATATYPE = 'WEEKLY PROMOLIFT QTY' THEN
                                   'PROMOLIFT QTY'
                               ELSE
                                   PTLDATATYPE
                           END AS [DATA TYPE],
                           CAST(DATEADD(dd, 7 - (DATEPART(dw, GETDATE())), GETDATE()) AS DATE) AS [CURR WeekEnd]
                    FROM Wholesale_DemandPlanning_AFI.PlanDetailTimeline
                ) DATATYPE
                    ON DATATYPE.[CURR WeekEnd] = [plan].[CURR WeekEnd]
                LEFT JOIN
                (
                    SELECT DISTINCT
                           CASE
                               WHEN Whse = 'CNW' THEN
                                   'C'
                               ELSE
                                   Whse
                           END AS [WHSE],
                           CAST(DATEADD(dd, 7 - (DATEPART(dw, GETDATE())), GETDATE()) AS DATE) AS [CURR WeekEnd]
                    FROM SupplyChain_Enh.PSWWeeklyExtractSnapshot
                    WHERE WHSE IN ( '1', '15', '17','201', '28', '42', '5', '70', 'ECR', '335', '49', '19', '12', 'C', 'CNW',
                                    '232'
                                  )
                ) whse
                    ON whse.[CURR WeekEnd] = [plan].[CURR WeekEnd]
                LEFT JOIN
                (
                    SELECT POFinal.podordernum,
                           POFinal.podvendornum,
                           POFinal.poditemnum,
                           CASE
                               WHEN POFinal.podwarehouse = 'CNW' THEN
                                   'C'
                               ELSE
                                   POFinal.podwarehouse
                           END AS [podwarehouse],
                           POFinal.poditemdescription,
                           POFinal.[Due Date],
                           POFinal.[ETD Date],
                           POFinal.[CURR WeekEnd DATE],
                           POFinal.poditemclass
                    FROM
                    (
                        SELECT po.podordernum,
                               po.podvendornum,
                               po.poditemnum,
                               po.podwarehouse,
                               po.poditemdescription,
                               po.poditemclass,
                               DT.CalendarWeekLastDate AS [Due Date],
                               mast1.[ETD Date],
                               CAST(DATEADD(dd, 7 - (DATEPART(dw, GETDATE())), GETDATE()) AS DATE) AS [CURR WeekEnd DATE]
                        FROM Wholesale_ProductSourcing_AFI.PoDetail po
                            INNER JOIN
                            (
                                SELECT *
                                FROM Enterprise_DW.DimDate
                                WHERE CalendarWeekIndicator
                                BETWEEN -10 AND 21
                            ) DT
                                ON DT.DateID = po.podduedate
                            LEFT JOIN
                            (
                                SELECT mast.pomordernum,
                                       mast.pomvendornum,
                                       mast.pomstatuscode,
                                       mast.pomwarehouse,
                                       mast.pometa,
                                       mast.pometd,
                                       DT1.CalendarWeekLastDate,
                                       DT2.CalendarWeekLastDate AS [ETD Date]
                                FROM Wholesale_ProductSourcing_AFI.PoMaster mast
                                    INNER JOIN
                                    (
                                        SELECT *
                                        FROM Enterprise_DW.DimDate
                                        WHERE CalendarWeekIndicator
                                        BETWEEN -10 AND 21
                                    ) DT1
                                        ON DT1.DateID = mast.pomdue
                                    INNER JOIN
                                    (
                                        SELECT *
                                        FROM Enterprise_DW.DimDate
                                        WHERE CalendarWeekIndicator
                                        BETWEEN -10 AND 21
                                    ) DT2
                                        ON DT2.DateID = mast.pometd
                                WHERE pomstatuscode <> '99'
                            ) mast1
                                ON mast1.pomordernum = po.podordernum
                                   AND mast1.pomvendornum = po.podvendornum
                                   AND mast1.CalendarWeekLastDate = DT.CalendarWeekLastDate
                                   AND mast1.pomwarehouse = po.podwarehouse
                        UNION
                        SELECT po.podordernum,
                               po.podvendornum,
                               po.poditemnum,
                               po.podwarehouse,
                               po.poditemdescription,
                               po.poditemclass,
                               DT.CalendarWeekLastDate AS [Due Date],
                               mast1.[ETD Date],
                               CAST(DATEADD(dd, 7 - (DATEPART(dw, GETDATE())), GETDATE()) AS DATE) AS [CURR WeekEnd DATE]
                        FROM Wholesale_ProductSourcing_WVF.PoDetail po
                            INNER JOIN
                            (
                                SELECT *
                                FROM Enterprise_DW.DimDate
                                WHERE CalendarWeekIndicator
                                BETWEEN -10 AND 21
                            ) DT
                                ON DT.DateID = po.podduedate
                            LEFT JOIN
                            (
                                SELECT mast.pomordernum,
                                       mast.pomvendornum,
                                       mast.pomstatuscode,
                                       mast.pomwarehouse,
                                       mast.pometa,
                                       mast.pometd,
                                       DT1.CalendarWeekLastDate,
                                       DT2.CalendarWeekLastDate AS [ETD Date]
                                FROM Wholesale_ProductSourcing_WVF.PoMaster mast
                                    INNER JOIN
                                    (
                                        SELECT *
                                        FROM Enterprise_DW.DimDate
                                        WHERE CalendarWeekIndicator
                                        BETWEEN -10 AND 21
                                    ) DT1
                                        ON DT1.DateID = mast.pomdue
                                    INNER JOIN
                                    (
                                        SELECT *
                                        FROM Enterprise_DW.DimDate
                                        WHERE CalendarWeekIndicator
                                        BETWEEN -10 AND 21
                                    ) DT2
                                        ON DT2.DateID = mast.pometd
                                WHERE pomstatuscode <> '99'
                            ) mast1
                                ON mast1.pomordernum = po.podordernum
                                   AND mast1.pomvendornum = po.podvendornum
                                   AND mast1.CalendarWeekLastDate = DT.CalendarWeekLastDate
                                   AND mast1.pomwarehouse = po.podwarehouse
                    ) POFinal
                --WHERE POFinal.poditemnum = 'M59241UN'
                ) POF
                    ON POF.[Due Date] = DT5.CalendarWeekLastDate
                       AND whse.WHSE = POF.podwarehouse
                       AND [plan].ITNBR = POF.poditemnum
                LEFT JOIN
                (
                    SELECT op1.PTLITNBR AS [item_number],
                           op1.PTLWHSE AS [warehouse],
                           CASE
                               WHEN op1.PTLDATATYPE = 'WEEKLY PROMOLIFT QTY' THEN
                                   'PROMOLIFT QTY'
                               ELSE
                                   op1.PTLDATATYPE
                           END AS [PTLDATATYPE],
                           CAST(DATEADD(
                                           DAY,
                                           7 - DATEPART(WEEKDAY, GETDATE())
                                           + (CAST(RIGHT(op1.Week, LEN(op1.Week) - PATINDEX('%[0-9]%', op1.Week) + 1) AS NUMERIC)
                                              - 1
                                             ) * 7,
                                           CAST(GETDATE() AS DATE)
                                       ) AS DATE) AS [Week_Ending],
                           CAST(op1.Orders AS INT) AS [ORDERS],
                           op1.[filter]
                    FROM
                    (
                        SELECT PTLITNBR,
                               PTLWHSE,
                               PTLDATATYPE,
                               [Week],
                               CASE
                                   WHEN [PTLDATATYPE] NOT IN ( 'SAFETY STK', 'SHIPPABLE INV', 'SI-SS' )
                                        AND Orders = 0 THEN
                                       0
                                   ELSE
                                       1
                               END AS [filter],
                               [Orders]
                        FROM
                        (
                            SELECT *
                            FROM Wholesale_DemandPlanning_AFI.PlanDetailTimeline
                            WHERE PTLWHSE IN ( '1', '15', '17','201', '28', '42', '5', '70', 'ECR', '335', '49', '19', '12' )
                                  AND PTLDATATYPE NOT IN ( 'KIT COMPT USAGE', 'NET FCST', 'PLANNED PROD', 'FIRM POS' )
                        ) p
                            UNPIVOT
                            (
                                [Orders]
                                FOR [Week] IN (PTLWEEK1, PTLWEEK2, PTLWEEK3, PTLWEEK4, PTLWEEK5, PTLWEEK6, PTLWEEK7,
                                               PTLWEEK8, PTLWEEK9, PTLWEEK10, PTLWEEK11, PTLWEEK12, PTLWEEK13,
                                               PTLWEEK14, PTLWEEK15, PTLWEEK16, PTLWEEK17, PTLWEEK18, PTLWEEK19,
                                               PTLWEEK20, PTLWEEK21, PTLWEEK22
                                              )
                            ) AS unpvt
                    ) [op1]
                    WHERE op1.filter = 1
                --AND op1.PTLITNBR = 'M59241UN'
                ) FINALPLAN
                    ON FINALPLAN.item_number = [plan].ITNBR
                       AND FINALPLAN.warehouse = whse.WHSE
                       AND FINALPLAN.PTLDATATYPE = DATATYPE.[DATA TYPE]
                       AND FINALPLAN.[Week_Ending] = CAST(DT5.CalendarWeekLastDate AS DATE)
                LEFT JOIN
                (
                    SELECT DISTINCT
                           unpvt.spdItem,
                           unpvt.spdWarehouse,
                           unpvt.spdWeekEnding,
                           unpvt.TYPE,
                           unpvt.[Orders Firmed],
                           [Scenario] = 'FIRM',
                           [Test] = 'FIRM POS'
                    FROM
                    (
                        SELECT spdItem,
                               spdWarehouse,
                               spdWeekEnding,
                               spdFirmTransferOut AS [FIRM TFR OUT],
                               spdOnOrderTransferIn AS [FIRM TFR IN]
                        FROM Wholesale_DemandPlanning_AFI.SupplyPlanDetail
                        WHERE CAST(dtea AS DATE) = @maxdatefirm
                    ) P
                        UNPIVOT
                        (
                            [Orders Firmed]
                            FOR [TYPE] IN ([FIRM TFR OUT], [FIRM TFR IN])
                        ) AS unpvt
                        INNER JOIN
                        (
                            SELECT *
                            FROM Enterprise_DW.DimDate
                            WHERE CalendarWeekIndicator
                            BETWEEN -10 AND 21
                        ) DT
                            ON DT.CalendarWeekLastDate = spdWeekEnding
                    WHERE unpvt.[Orders Firmed] <> 0
                --AND unpvt.spdItem = 'M59241UN'
                ) FIRM
                    ON FIRM.spdItem = [plan].ITNBR
                       AND FIRM.spdWarehouse = whse.WHSE
                       AND FIRM.Test = DATATYPE.[DATA TYPE]
                       AND FIRM.spdWeekEnding = DT5.CalendarWeekLastDate
                LEFT JOIN
                (
                    SELECT *,
                           [TYPE] AS [DATA TYPE]
                    FROM
                    (
                        SELECT *
                        FROM
                        (
                            SELECT DISTINCT
                                   FQ.ITEM AS [item_number],
                                   FQ.WHSE AS [warehouse],
                                   FQ.[LOCATION],
                                   FQ.Vendor#,
                                   FQ.[VENDOR NAME],
                                   SUM(FQ.FQTY) AS [FIRMED],
                                   SUM(FQ.SQTY) AS [SHIPPED],
                                   FQ.[ETD DATE],
                                   [Scenario] = 'PSWWeekly'
                            FROM
                            (
                                SELECT PSWWEEKLY.ITEM,
                                       PSWWEEKLY.WHSE,
                                       PSWWEEKLY.Vendor#,
                                       PSWWEEKLY.[VENDOR NAME],
                                       [PSWWEEKLY].[LOCATION],
                                       (PSWWEEKLY.FQTY),
                                       (PSWWEEKLY.SQTY),
                                       PSWWEEKLY.[ETD DATE]
                                FROM
                                (
                                    SELECT DISTINCT
                                           Item AS [ITEM],
                                           CASE
                                               WHEN Whse = 'CNW' THEN
                                                   'C'
                                               ELSE
                                                   Whse
                                           END AS [WHSE],
                                           PSW.Vendor AS [Vendor#],
                                           PSW.VNAME AS [VENDOR NAME],
                                           CASE
                                               WHEN Whse IN ( 'C', 'CNW' ) THEN
                                                   'C&CNW'
                                               WHEN Whse IN ( '1', '15', '17','201', '28', '42', '5', '70', 'ECR', '335', '49',
                                                              '19', '12'
                                                            ) THEN
                                                   'AFI'
                                               WHEN Whse IN ( '232' ) THEN
                                                   '232'
                                           END AS [LOCATION],
                                           CAST(FQty AS INT) AS [FQTY],
                                           CAST(SQty AS INT) AS [SQTY],
                                           DT3.CalendarWeekLastDate AS [ETD DATE]
                                    FROM SupplyChain_Enh.PSWWeeklyExtractSnapshot PSW
                                        INNER JOIN
                                        (
                                            SELECT *
                                            FROM Enterprise_DW.DimDate
                                            WHERE CalendarWeekIndicator
                                            BETWEEN -10 AND 21
                                        ) DT3
                                            ON DT3.CalendarWeekIndicator = PSW.WeekNum
                                    WHERE CAST(PSW.SPRunDate AS DATE) = @maxdate
                                          AND PSW.Whse IN ( '1', '15', '17','201', '28', '42', '5', '70', 'ECR', '335', '49',
                                                            '19', '12', 'C', 'CNW', '232'
                                                          )
                                --AND PSW.[Item] = 'M59241UN'
                                ) PSWWEEKLY
                            ) FQ
                            GROUP BY FQ.[LOCATION],
                                     FQ.[ETD DATE],
                                     FQ.ITEM,
                                     FQ.WHSE,
                                     FQ.Vendor#,
                                     FQ.[VENDOR NAME]
                        ) TEST1
                        WHERE CASE
                                  WHEN TEST1.[FIRMED] = 0
                                       AND TEST1.[SHIPPED] = 0 THEN
                                      0
                                  ELSE
                                      1
                              END = 1
                    ) p
                        UNPIVOT
                        (
                            [QTY]
                            FOR [TYPE] IN ([FIRMED], [SHIPPED])
                        ) AS unpvt
                    WHERE QTY <> 0
                ) PSW
                    ON PSW.item_number = [plan].ITNBR
                       AND PSW.warehouse = whse.WHSE
                       AND PSW.[DATA TYPE] = DATATYPE.[DATA TYPE]
                       AND PSW.Vendor# = POF.podvendornum
                       AND PSW.[ETD DATE] = CAST(POF.[ETD Date] AS DATE)
                LEFT JOIN
                (
                    SELECT *
                    FROM
                    (
                        SELECT DISTINCT
                               vndr.*
                        FROM
                        (
                            SELECT DISTINCT
                                   A.vdpvendornum AS Vendor,
                                   A.vdpitemnum AS item_number,
                                   CONCAT(A.vdpvendornum, ':', Delivery.VNAME) AS [VENDOR & NAME],
                                   A.vdpsplit AS [Vendor Split],
                                   DELIVERY.VNAME,
                                   DELIVERY.VNAMA AS [OFFICE],
                                   DELIVERY.FOBCD,
                                   DELIVERY.[delivery final] + 7 AS [Delivery],
                                   DELIVERY.dltwarehouse,
                                   MAX(A.vdpsplit) OVER (PARTITION BY [vdpitemnum]) AS [Max Split],
                                   CASE
                                       WHEN MAX(A.vdpsplit) OVER (PARTITION BY [vdpitemnum]) = A.vdpsplit THEN
                                           A.vdpvendornum
                                       ELSE
                                           ''
                                   END AS [Max Vendor]
                            FROM
                            (
                                SELECT DISTINCT
                                       *
                                FROM Wholesale_Vendors_AFI.[VendorPricing] afi
                                UNION
                                SELECT DISTINCT
                                       *
                                FROM Wholesale_Vendors_WNK.VendorPricing wnk
                            ) A
                                LEFT JOIN
                                (
                                    SELECT ven.*
                                    FROM
                                    (
                                        SELECT *
                                        FROM Wholesale_Purchasing_AFI.VENNAM
                                        UNION
                                        SELECT *
                                        FROM Wholesale_Purchasing_MIL.VENNAM
                                        UNION
                                        SELECT *
                                        FROM Wholesale_Purchasing_WNK.VENNAM
                                        UNION
                                        SELECT *
                                        FROM Wholesale_Purchasing_WVF.VENNAM
                                    ) ven
                                ) desc1
                                    ON desc1.VNDNR = A.vdpvendornum
                                LEFT JOIN
                                (
                                    SELECT DISTINCT
                                           a.VNDNR,
                                           a.VNAME,
                                           a.VNAMA,
                                           a.FOBCD,
                                           DEL.dltdeliverytime AS [delivery final],
                                           DEL.dltwarehouse,
                                           DEL.dltfobcode
                                    FROM
                                    (
                                        SELECT DISTINCT
                                               *
                                        FROM Wholesale_Purchasing_AFI.VENNAM ven0
                                        UNION
                                        SELECT DISTINCT
                                               *
                                        FROM Wholesale_Purchasing_WVF.VENNAM ven1
                                        UNION
                                        SELECT DISTINCT
                                               *
                                        FROM Wholesale_Purchasing_MIL.VENNAM ven2
                                        UNION
                                        SELECT DISTINCT
                                               *
                                        FROM Wholesale_Purchasing_WNK.VENNAM ven3
                                    ) a
                                        LEFT JOIN
                                        (SELECT * FROM Wholesale_ProductSourcing_AFI.DeliveryTimes) DEL
                                            ON DEL.dltfobcode = a.FOBCD
                                    WHERE DEL.dltwarehouse IN ( '1', '15', '17','201', '28', '42', '5', '70', 'ECR', '335',
                                                                '49', '19', '12'
                                                              )
                                ) DELIVERY
                                    ON DELIVERY.VNDNR = A.vdpvendornum
                            WHERE A.vdpsplit > 0
                        --AND A.vdpitemnum = 'M59241UN'
                        ) vndr
                        WHERE vndr.[Max Vendor] <> ''
                    ) vndr0
                ) vndr1
                    ON vndr1.item_number = [plan].ITNBR
                       AND vndr1.dltwarehouse = whse.WHSE
            WHERE COALESCE(COALESCE(FINALPLAN.ORDERS, PSW.QTY), FIRM.[Orders Firmed]) IS NOT NULL
                  AND CASE
                          WHEN [DATATYPE].[DATA TYPE] NOT IN ( 'SAFETY STK', 'SHIPPABLE INV', 'SI-SS' )
                               AND COALESCE(COALESCE(FINALPLAN.ORDERS, PSW.QTY), FIRM.[Orders Firmed]) = 0 THEN
                              0
                          ELSE
                              1
                      END = 1
        ) TRIAL
    ) t
) t1;



select * from PowerBI_SupplyChain.SupplyPlanDetailCurrentDay
where spdItem ='981X317UN'







IF OBJECT_ID('tempdb..#temp_si') IS NOT NULL
    DROP TABLE #temp_si;

IF OBJECT_ID('tempdb..#report_staging') IS NOT NULL
    DROP TABLE #report_staging;

DECLARE @current_ss DATE = (
		SELECT CAST(MAX([SnapShotDate]) AS DATE)
		FROM [SupplyChain_Enh].[PlanDetailTimelineSnapshot]
		);
DECLARE @last_ss DATE = DATEADD(DAY, - 7, @current_ss);

SELECT 
    [PL].[PTLITNBR] [PDTITNBR],
    [PL].[PTLWHSE] [PDTWHSE],
    [PL].[WeekDate] [PDTWKENDING],
    [PL].SnapshotDate,
    [PL].[PDTSHIPPABLEINV]
INTO #temp_si
FROM (
    SELECT [PTLITNBR],
        [PTLWHSE],
        [PTLDATATYPE],
		[FiscalWeekLastDate],
        WeekNumber,
        Value [PDTSHIPPABLEINV],
        CAST(DATEADD(WEEK, WeekNumber - 1, [FiscalWeekLastDate]) AS DATE) AS WeekDate,
        CAST([SnapshotDate] AS DATE) [SnapshotDate]
    FROM (
        SELECT
            [PTLITNBR],
            [PTLWHSE],
            [PTLDATATYPE],
			[DD].[FiscalWeekLastDate],
            [SnapshotDate],
            [PTLWEEK1], [PTLWEEK2], [PTLWEEK3], [PTLWEEK4], [PTLWEEK5],
            [PTLWEEK6], [PTLWEEK7], [PTLWEEK8], [PTLWEEK9], [PTLWEEK10],
            [PTLWEEK11], [PTLWEEK12], [PTLWEEK13], [PTLWEEK14], [PTLWEEK15],
            [PTLWEEK16], [PTLWEEK17], [PTLWEEK18], [PTLWEEK19], [PTLWEEK20],
            [PTLWEEK21], [PTLWEEK22]
        FROM [SupplyChain_Enh].[PlanDetailTimelineSnapshot] [PTS]
        LEFT JOIN [Enterprise_DW].[DimDate_NonRetail] [DD]
          ON CONVERT(DATE, [PTS].[SnapShotDate]) = [DD].[DateID]
        WHERE [PTLDATATYPE] = 'SHIPPABLE INV'
          --AND CAST([SnapshotDate] AS DATE) = (SELECT CAST(MAX([SnapshotDate]) AS DATE) FROM [SupplyChain_Enh].[PlanDetailTimelineSnapshot])
		  AND CAST([SnapshotDate] AS DATE) IN (@current_ss, @last_ss)
          AND [PTLWHSE] IN ('1', '15', '17', '28', '335', '5', 'ECR')
    ) _first
    UNPIVOT (
        Value FOR WeekColumn IN (
            [PTLWEEK1], [PTLWEEK2], [PTLWEEK3], [PTLWEEK4], [PTLWEEK5],
            [PTLWEEK6], [PTLWEEK7], [PTLWEEK8], [PTLWEEK9], [PTLWEEK10],
            [PTLWEEK11], [PTLWEEK12], [PTLWEEK13], [PTLWEEK14], [PTLWEEK15],
            [PTLWEEK16], [PTLWEEK17], [PTLWEEK18], [PTLWEEK19], [PTLWEEK20],
            [PTLWEEK21], [PTLWEEK22]
        )
    ) AS unpvt
    CROSS APPLY (
        SELECT CAST(REPLACE(WeekColumn, 'PTLWEEK', '') AS INT) AS WeekNumber
    ) AS WeekCalc
) PL;

SELECT [Item Ext Series Number]
  , [VendorNumber]
  , [Collective Class]
  , [Import/Domestic Code]
  , CASE
		WHEN [_second].[Collective Class] IN ('BEDDING', 'BEDROOM', 'DINING', 'STATIONARY UPH', 'MOTION UPH') THEN 'Priority'
		ELSE 'Others'
		END [Collective Class Group]
  --, [PDTWKENDING]
  , [ShippableInv]
  , [ShippableInv ($FOB)]
  , [NegativeShippableInv]
  , [NegativeShippableInv ($FOB)]
  , [CumSumNegativeShippableInv]
  , [CumSumNegativeShippableInv ($FOB)]
  , CASE WHEN [RN] = [CONSECUTIVE_RN] AND CumSumNegativeShippableInv < 0 THEN 4 ELSE [RN] - [CONSECUTIVE_RN] END [ConsecutiveNegativeWk]
INTO #report_staging
FROM (
  SELECT [Item Ext Series Number]
    , [VendorNumber]
	, [Collective Class]
	, [Import/Domestic Code]
    , [PDTWKENDING]
    , [ShippableInv]
    , [ShippableInv ($FOB)]
    , [NegativeShippableInv]
    , [NegativeShippableInv ($FOB)]
    , SUM([NegativeShippableInv]) OVER (PARTITION BY [Item Ext Series Number], [VendorNumber], [SnapshotDate] ORDER BY [PDTWKENDING] ROWS UNBOUNDED PRECEDING) AS [CumSumNegativeShippableInv]
    , SUM([NegativeShippableInv ($FOB)]) OVER (PARTITION BY [Item Ext Series Number], [VendorNumber], [SnapshotDate] ORDER BY [PDTWKENDING] ROWS UNBOUNDED PRECEDING) AS [CumSumNegativeShippableInv ($FOB)]
    , [RN]
    , [REVERSE_RN]
    , ROW_NUMBER() OVER (PARTITION BY [Item Ext Series Number],[VendorNumber] ,[SnapShotDate], CASE WHEN [NegativeShippableInv] < 0 THEN 1 ELSE 0 END ORDER BY RN) AS [CONSECUTIVE_RN]
  FROM (
    SELECT [CPD].[Item Ext Series Number]
        , [VendorNumber]
		, [CPD].[Collective Class]
		, [CPD].[Import/Domestic Code]
        -- , [PDTITNBR]
        , [PDTWKENDING]
        , SUM([PDTSHIPPABLEINV]) [ShippableInv]
        , SUM([PDTSHIPPABLEINV] * ITM.[FOBArcPrice] ) [ShippableInv ($FOB)]
        , SUM(CASE WHEN [PDTSHIPPABLEINV] < 0 THEN [PDTSHIPPABLEINV] ELSE 0 END) [NegativeShippableInv]
        , SUM(CASE WHEN [PDTSHIPPABLEINV] < 0 THEN [PDTSHIPPABLEINV] * ITM.[FOBArcPrice]  ELSE 0 END) [NegativeShippableInv ($FOB)]
      , ROW_NUMBER() OVER (PARTITION BY [Item Ext Series Number], [VendorNumber], [SnapshotDate] ORDER BY [PDTWKENDING] ASC) [RN]
      , ROW_NUMBER() OVER (PARTITION BY [Item Ext Series Number], [VendorNumber], [SnapshotDate] ORDER BY [PDTWKENDING] DESC) [REVERSE_RN]
        , [SnapShotDate]
    FROM #temp_si												  AS [PDS]
    LEFT JOIN [Enterprise_DW].[DimDate_NonRetail]               AS [DD]
        ON [PDS].[PDTWKENDING] = [DD].[DateID]
    INNER JOIN [SupplyChain_DW].[DimCurrentProductDetails]      AS [CPD]
        ON [PDS].[PDTITNBR] = [CPD].[Item SKU]
    LEFT JOIN [MasterData_ItemMaster_AFI].[ITMEXT]              AS [EXT]
        ON [PDS].[PDTITNBR] = [EXT].[ITNBR]
    LEFT JOIN [Enterprise_DW].[DimItemMaster]                   AS [ITM]
        ON [PDS].[PDTITNBR] = ITM.[ItemSKU]
	LEFT JOIN [PowerBI_SupplyChain].[ITPItemMaster]	AS [ITP]
		ON[CPD].[Item SKU] =[ITP].[Item SKU]
    LEFT JOIN [MasterData_ProductKnowledge].[Item_ENV]          AS [IPK]
        ON [CPD].[Item SKU] = [IPK].[ienItemNumber]
    LEFT JOIN [PowerBI_SupplyChain].[VendorMaster]              AS [VM]
        ON TRIM([CPD].[Primary Vendor]) = [VM].[VendorNumber]
    WHERE CONVERT(DATE, [PDS].[SnapshotDate]) = @current_ss
	-- WHERE CONVERT(DATE, [PDS].[SnapshotDate]) = '2026-04-30'
      AND [FiscalWeekIndicator] + 1 IN (1, 4, 8, 12)
      AND [CPD].[Sellable Item Flag] = 'Y'
      AND [IPK].[ienEnvironmentCode] = 'AFI'
      AND [CPD].[AFI Item Status] NOT IN ('D', 'N')
      AND [EXT].[FRTNAT] BETWEEN 15900 AND 15999
	  AND [ITP].[Item Type]='FG'
      --AND [CPD].[Item Ext Series Number] IN ('A2000489', 'A2000787', 'A2000664', '31004')
    GROUP BY [CPD].[Item Ext Series Number]
        , [VendorNumber]
		, [CPD].[Collective Class]
		, [CPD].[Import/Domestic Code]
        -- , [PDTITNBR]
        , [PDTWKENDING]
        , [SnapshotDate]
  ) _first
) _second
WHERE [REVERSE_RN] = 1;

WITH min_max_cte AS (
  SELECT MIN(ABS([CumSumNegativeShippableInv])) [min_cumsum_inv]
    , MAX(ABS([CumSumNegativeShippableInv])) [max_cumsum_inv]
    , MIN(ABS([CumSumNegativeShippableInv ($FOB)])) [min_cumsum_fob]
    , MAX(ABS([CumSumNegativeShippableInv ($FOB)])) [max_cumsum_fob]
  FROM #report_staging
),

normalized AS (
SELECT [Item Ext Series Number]
    , [VendorNumber]
	, [Collective Class]
	, [Import/Domestic Code]
	, [Collective Class Group]
	--, [PDTWKENDING]
	-- , [ShippableInv]
	-- , [ShippableInv ($FOB)]
	-- , [NegativeShippableInv]
  -- , [NegativeShippableInv ($FOB)]
	, [CumSumNegativeShippableInv]
	, [CumSumNegativeShippableInv ($FOB)]
	, [ConsecutiveNegativeWk]
	-- Normalized Cols
	, CASE 
		WHEN (min_max_cte.max_cumsum_inv - min_max_cte.min_cumsum_inv) = 0
			THEN 0
		ELSE (ABS([CumSumNegativeShippableInv]) - min_max_cte.min_cumsum_inv) * 1.0 / (min_max_cte.max_cumsum_inv - min_max_cte.min_cumsum_inv)
		END AS [Normalized_Cumsum_Inv]
	, CASE 
		WHEN (min_max_cte.max_cumsum_fob - min_max_cte.min_cumsum_fob) = 0
			THEN 0
		ELSE (ABS([CumSumNegativeShippableInv ($FOB)]) - min_max_cte.min_cumsum_fob) * 1.0 / (min_max_cte.max_cumsum_fob - min_max_cte.min_cumsum_fob)
		END AS [Normalized_Cumsum_FOB]
FROM #report_staging
CROSS JOIN min_max_cte
), 

scored AS (
SELECT [Item Ext Series Number]
    , [VendorNumber]
	, [Collective Class]
	, [Import/Domestic Code]
	, [Collective Class Group]
	--, [PDTWKENDING]
	-- , [ShippableInv]
	-- , [ShippableInv ($FOB)]
	-- , [NegativeShippableInv]
  -- , [NegativeShippableInv ($FOB)]
	, [CumSumNegativeShippableInv]
	, [CumSumNegativeShippableInv ($FOB)]
	, [ConsecutiveNegativeWk]
	, [Normalized_Cumsum_Inv]
	, [Normalized_Cumsum_FOB]
	, [CompositeScore] = 0.35 * [Normalized_Cumsum_Inv] + 0.65 * [Normalized_Cumsum_FOB]
FROM normalized
)

SELECT [Item Ext Series Number]
    , [VendorNumber]
	, [Collective Class]
	, [Import/Domestic Code]
	, [Collective Class Group]
	--, [PDTWKENDING]
	-- , [ShippableInv]
	-- , [ShippableInv ($FOB)]
	-- , [NegativeShippableInv]
  -- , [NegativeShippableInv ($FOB)]
	, [CumSumNegativeShippableInv]
	, [CumSumNegativeShippableInv ($FOB)]
	, [ConsecutiveNegativeWk]
	, [Normalized_Cumsum_Inv]
	, [Normalized_Cumsum_FOB]
	, [CompositeScore]
	, CASE WHEN [ConsecutiveNegativeWk] >= 3
    THEN 
        RANK() OVER (
            PARTITION BY 
                CASE 
                    WHEN [Collective Class Group] = 'Priority'
                         AND [ConsecutiveNegativeWk] >= 3
                    THEN [Collective Class]      -- ví dụ: BEDDING, DINING, UPH
                    WHEN [Collective Class Group] = 'Others'
                         AND [ConsecutiveNegativeWk] >= 3
                    THEN 'Others'
                    ELSE NULL
                END,
                [Import/Domestic Code]                      -- THÊM DÒNG NÀY ĐỂ TÁCH IMPORT / DOMESTIC
            ORDER BY [CompositeScore] DESC
        )
    ELSE NULL 
END AS [Collective Class Rank]
FROM scored
ORDER BY [Item Ext Series Number]




WITH LatestMonday AS (
    SELECT MAX(CAST(LGL.FileDate AS date)) AS LatestFileDate
    FROM SupplyChain_Enh.ForecastCommonContainer_Logility AS LGL
    INNER JOIN Enterprise_DW.DimDate AS DD
        ON DD.DateID = CAST(LGL.FileDate AS date)
    WHERE DD.CalendarDayOfWeekName = 'Monday'
),
LatestProd AS (
    SELECT ItemID, LocationID, ProdResourceID
    FROM SupplyChain_Enh.ProductionConversion
    WHERE SnapshotDate = (
        SELECT MAX(SnapshotDate)
        FROM SupplyChain_Enh.ProductionConversion
    )
      AND EndEffectiveDate IS NOT NULL
)
SELECT
    PR.ProdResourceID AS Prod,
    LGL.[Planning Vendor] AS Vendor,
    CASE
        WHEN LGL.[Planning Vendor] = '624556' THEN 'Mille'
        ELSE 'Wanek'
    END AS GeneralVendor,
    CPD.[Series Number] AS Series,
    LGL.[Item-Lvl1] AS Item,
    LGL.Location AS Warehouse,
    LGL.MK_BuyCODE AS MakeBuyCode,
    CPD.[Current Status] AS CurrentStatus,
    CPD.[Future Status] AS FutureStatus
FROM SupplyChain_Enh.ForecastCommonContainer_Logility AS LGL
CROSS JOIN LatestMonday AS LM
INNER JOIN Enterprise_DW.DimDate AS DD
    ON DD.DateID = CAST(LGL.FileDate AS date)
LEFT JOIN LatestProd AS PR
    ON PR.ItemID = LGL.[Item-Lvl1]
   AND PR.LocationID = LGL.[Planning Vendor]
LEFT JOIN PowerBI_SupplyChain.CurrentProductDetails AS CPD
    ON CPD.[Item SKU] = LGL.[Item-Lvl1]
WHERE CAST(LGL.FileDate AS date) = LM.LatestFileDate
  AND DD.CalendarDayOfWeekName = 'Monday'
  AND LGL.[Planning Vendor] IN ('624556', '600039', '900515', '900639');




select * from  [SupplyChain_DW].[DimCurrentProductDetails]
where [Item SKU] like 'B4807%'