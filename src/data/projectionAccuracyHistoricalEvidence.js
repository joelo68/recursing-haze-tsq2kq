// Immutable month-level presentation evidence generated from the approved B2A0 production read-only backtest.
// Historical backtest rows stay explicitly separate from natural live projection_accuracy checkpoints.
// Only normalized WAPE components are embedded here; exact historical revenue totals are intentionally excluded.
// No Firestore access or Projection calculation occurs in this module.

const deepFreezeEvidence = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreezeEvidence);
  return Object.freeze(value);
};

export const PROJECTION_ACCURACY_HISTORICAL_EVIDENCE = deepFreezeEvidence(
{
  "evidenceVersion": "projection-accuracy-historical-evidence-v2",
  "auditSchemaVersion": "projection-accuracy-historical-backtest-readonly-v1",
  "statisticsVersion": "normalized-wape-components-v1",
  "generatedAtText": "2026-09-10T02:26:11.181Z",
  "sourceJsonSha256": "01fd6c14e4029783be362d764087e1979a93f69d793aa5e3e6e02723e3fc4da6",
  "sourceReportSha256": "dd963b26acd62e006d942353f1ded132edcf57b8c6e7a9c1f1126bfb0a380afb",
  "readWindow": {
    "startDate": "2026-02-01",
    "endDate": "2026-08-31"
  },
  "targetMonths": [
    "2026-05",
    "2026-06",
    "2026-07",
    "2026-08"
  ],
  "checkpointDays": [
    5,
    7,
    10,
    15,
    20,
    25
  ],
  "brandIds": [
    "cyj",
    "anniu"
  ],
  "auditCost": {
    "estimatedBilledReads": 10147,
    "writes": 0,
    "persistentListeners": 0,
    "polling": 0
  },
  "brands": {
    "cyj": {
      "brandId": "cyj",
      "rawRowCount": 6624,
      "estimatedBilledReads": 6626,
      "months": {
        "2026-05": {
          "brandId": "cyj",
          "yearMonth": "2026-05",
          "evidenceType": "historical_backtest",
          "comparisonMode": "v2_vs_v1_vs_pace",
          "statisticsVersion": "normalized-wape-components-v1",
          "complete": true,
          "strategyVersion": "projection-strategy-v2-phase-calibrated",
          "sourceMonths": [
            "2026-02",
            "2026-03",
            "2026-04"
          ],
          "checkpoints": {
            "day05": {
              "cutoffDay": 5,
              "cutoffDate": "2026-05-05",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": 0.23857180573,
                  "absErrorWeight": 0.23857180573
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.160068871826,
                  "absErrorWeight": 0.160068871826
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.147050947462,
                  "absErrorWeight": 0.147050947462
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": 0.094928959536,
                  "absErrorWeight": 0.094928959536
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.223284211905,
                  "absErrorWeight": 0.223284211905
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.195218039316,
                  "absErrorWeight": 0.195218039316
                }
              }
            },
            "day07": {
              "cutoffDay": 7,
              "cutoffDate": "2026-05-07",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": 0.048670679925,
                  "absErrorWeight": 0.048670679925
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.143598278162,
                  "absErrorWeight": 0.143598278162
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.136418082626,
                  "absErrorWeight": 0.136418082626
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": 0.013292108441,
                  "absErrorWeight": 0.013292108441
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.203786315726,
                  "absErrorWeight": 0.203786315726
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.1830441297,
                  "absErrorWeight": 0.1830441297
                }
              }
            },
            "day10": {
              "cutoffDay": 10,
              "cutoffDate": "2026-05-10",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.00600655582,
                  "absErrorWeight": 0.00600655582
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.147957639794,
                  "absErrorWeight": 0.147957639794
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.134684153009,
                  "absErrorWeight": 0.134684153009
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.056859459412,
                  "absErrorWeight": 0.056859459412
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.18473250818,
                  "absErrorWeight": 0.18473250818
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.159847829925,
                  "absErrorWeight": 0.159847829925
                }
              }
            },
            "day15": {
              "cutoffDay": 15,
              "cutoffDate": "2026-05-15",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.107556276763,
                  "absErrorWeight": 0.107556276763
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.140216285504,
                  "absErrorWeight": 0.140216285504
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.138651871969,
                  "absErrorWeight": 0.138651871969
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.060933179563,
                  "absErrorWeight": 0.060933179563
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.12603732438,
                  "absErrorWeight": 0.12603732438
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.088359920986,
                  "absErrorWeight": 0.088359920986
                }
              }
            },
            "day20": {
              "cutoffDay": 20,
              "cutoffDate": "2026-05-20",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.116536584495,
                  "absErrorWeight": 0.116536584495
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.127664785032,
                  "absErrorWeight": 0.127664785032
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.125899756494,
                  "absErrorWeight": 0.125899756494
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.067607400504,
                  "absErrorWeight": 0.067607400504
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.097354120826,
                  "absErrorWeight": 0.097354120826
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.079460356,
                  "absErrorWeight": 0.079460356
                }
              }
            },
            "day25": {
              "cutoffDay": 25,
              "cutoffDate": "2026-05-25",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.069260112932,
                  "absErrorWeight": 0.069260112932
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.064466804509,
                  "absErrorWeight": 0.064466804509
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.061788462384,
                  "absErrorWeight": 0.061788462384
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.067916049163,
                  "absErrorWeight": 0.067916049163
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.070893331444,
                  "absErrorWeight": 0.070893331444
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.065611864936,
                  "absErrorWeight": 0.065611864936
                }
              }
            }
          }
        },
        "2026-06": {
          "brandId": "cyj",
          "yearMonth": "2026-06",
          "evidenceType": "historical_backtest",
          "comparisonMode": "v2_vs_v1_vs_pace",
          "statisticsVersion": "normalized-wape-components-v1",
          "complete": true,
          "strategyVersion": "projection-strategy-v2-phase-calibrated",
          "sourceMonths": [
            "2026-03",
            "2026-04",
            "2026-05"
          ],
          "checkpoints": {
            "day05": {
              "cutoffDay": 5,
              "cutoffDate": "2026-06-05",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.032438451401,
                  "errorWeight": 0.112082697723,
                  "absErrorWeight": 0.112082697723
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.032438451401,
                  "errorWeight": -0.278418062014,
                  "absErrorWeight": 0.278418062014
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.032438451401,
                  "errorWeight": -0.288412590042,
                  "absErrorWeight": 0.288412590042
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.052902800949,
                  "errorWeight": 0.036350943966,
                  "absErrorWeight": 0.036350943966
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.052902800949,
                  "errorWeight": -0.300469123055,
                  "absErrorWeight": 0.300469123055
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.052902800949,
                  "errorWeight": -0.269515908231,
                  "absErrorWeight": 0.269515908231
                }
              }
            },
            "day07": {
              "cutoffDay": 7,
              "cutoffDate": "2026-06-07",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.032438451401,
                  "errorWeight": 0.015703337148,
                  "absErrorWeight": 0.015703337148
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.032438451401,
                  "errorWeight": -0.194237088345,
                  "absErrorWeight": 0.194237088345
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.032438451401,
                  "errorWeight": -0.136224568243,
                  "absErrorWeight": 0.136224568243
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.052902800949,
                  "errorWeight": -0.047499478416,
                  "absErrorWeight": 0.047499478416
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.052902800949,
                  "errorWeight": -0.281582025206,
                  "absErrorWeight": 0.281582025206
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.052902800949,
                  "errorWeight": -0.25516944553,
                  "absErrorWeight": 0.25516944553
                }
              }
            },
            "day10": {
              "cutoffDay": 10,
              "cutoffDate": "2026-06-10",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.032438451401,
                  "errorWeight": -0.031881906552,
                  "absErrorWeight": 0.031881906552
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.032438451401,
                  "errorWeight": -0.190471272686,
                  "absErrorWeight": 0.190471272686
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.032438451401,
                  "errorWeight": -0.150715197282,
                  "absErrorWeight": 0.150715197282
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.052902800949,
                  "errorWeight": -0.074309162239,
                  "absErrorWeight": 0.074309162239
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.052902800949,
                  "errorWeight": -0.222392332345,
                  "absErrorWeight": 0.222392332345
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.052902800949,
                  "errorWeight": -0.170285470977,
                  "absErrorWeight": 0.170285470977
                }
              }
            },
            "day15": {
              "cutoffDay": 15,
              "cutoffDate": "2026-06-15",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.032438451401,
                  "errorWeight": -0.107306376861,
                  "absErrorWeight": 0.107306376861
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.032438451401,
                  "errorWeight": -0.188393427354,
                  "absErrorWeight": 0.188393427354
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.032438451401,
                  "errorWeight": -0.156559817007,
                  "absErrorWeight": 0.156559817007
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.052902800949,
                  "errorWeight": -0.118693148338,
                  "absErrorWeight": 0.118693148338
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.052902800949,
                  "errorWeight": -0.195644282367,
                  "absErrorWeight": 0.195644282367
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.052902800949,
                  "errorWeight": -0.153734892483,
                  "absErrorWeight": 0.153734892483
                }
              }
            },
            "day20": {
              "cutoffDay": 20,
              "cutoffDate": "2026-06-20",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.032438451401,
                  "errorWeight": -0.10525897132,
                  "absErrorWeight": 0.10525897132
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.032438451401,
                  "errorWeight": -0.146748676738,
                  "absErrorWeight": 0.146748676738
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.032438451401,
                  "errorWeight": -0.131170334482,
                  "absErrorWeight": 0.131170334482
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.052902800949,
                  "errorWeight": -0.094476986884,
                  "absErrorWeight": 0.094476986884
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.052902800949,
                  "errorWeight": -0.13165548641,
                  "absErrorWeight": 0.13165548641
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.052902800949,
                  "errorWeight": -0.111695176582,
                  "absErrorWeight": 0.111695176582
                }
              }
            },
            "day25": {
              "cutoffDay": 25,
              "cutoffDate": "2026-06-25",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.032438451401,
                  "errorWeight": -0.094160791128,
                  "absErrorWeight": 0.094160791128
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.032438451401,
                  "errorWeight": -0.096010607668,
                  "absErrorWeight": 0.096010607668
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.032438451401,
                  "errorWeight": -0.092087859305,
                  "absErrorWeight": 0.092087859305
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.052902800949,
                  "errorWeight": -0.079421069085,
                  "absErrorWeight": 0.079421069085
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.052902800949,
                  "errorWeight": -0.091276395114,
                  "absErrorWeight": 0.091276395114
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.052902800949,
                  "errorWeight": -0.085587729719,
                  "absErrorWeight": 0.085587729719
                }
              }
            }
          }
        },
        "2026-07": {
          "brandId": "cyj",
          "yearMonth": "2026-07",
          "evidenceType": "historical_backtest",
          "comparisonMode": "v2_vs_v1_vs_pace",
          "statisticsVersion": "normalized-wape-components-v1",
          "complete": true,
          "strategyVersion": "projection-strategy-v2-phase-calibrated",
          "sourceMonths": [
            "2026-04",
            "2026-05",
            "2026-06"
          ],
          "checkpoints": {
            "day05": {
              "cutoffDay": 5,
              "cutoffDate": "2026-07-05",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.149866028965,
                  "errorWeight": -0.086926996392,
                  "absErrorWeight": 0.086926996392
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.149866028965,
                  "errorWeight": -0.313585308894,
                  "absErrorWeight": 0.313585308894
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.149866028965,
                  "errorWeight": -0.063445693315,
                  "absErrorWeight": 0.063445693315
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.031451665894,
                  "errorWeight": -0.106385476765,
                  "absErrorWeight": 0.106385476765
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.031451665894,
                  "errorWeight": -0.289915086194,
                  "absErrorWeight": 0.289915086194
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.031451665894,
                  "errorWeight": -0.218251784485,
                  "absErrorWeight": 0.218251784485
                }
              }
            },
            "day07": {
              "cutoffDay": 7,
              "cutoffDate": "2026-07-07",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.149866028965,
                  "errorWeight": -0.091981499797,
                  "absErrorWeight": 0.091981499797
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.149866028965,
                  "errorWeight": -0.201575325122,
                  "absErrorWeight": 0.201575325122
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.149866028965,
                  "errorWeight": -0.0227181811,
                  "absErrorWeight": 0.0227181811
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.031451665894,
                  "errorWeight": -0.038286896599,
                  "absErrorWeight": 0.038286896599
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.031451665894,
                  "errorWeight": -0.209499432231,
                  "absErrorWeight": 0.209499432231
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.031451665894,
                  "errorWeight": -0.125779069514,
                  "absErrorWeight": 0.125779069514
                }
              }
            },
            "day10": {
              "cutoffDay": 10,
              "cutoffDate": "2026-07-10",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.149866028965,
                  "errorWeight": -0.057635797722,
                  "absErrorWeight": 0.057635797722
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.149866028965,
                  "errorWeight": -0.154319136766,
                  "absErrorWeight": 0.154319136766
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.149866028965,
                  "errorWeight": 0.010705249222,
                  "absErrorWeight": 0.010705249222
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.031451665894,
                  "errorWeight": -0.142859741691,
                  "absErrorWeight": 0.142859741691
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.031451665894,
                  "errorWeight": -0.241716087608,
                  "absErrorWeight": 0.241716087608
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.031451665894,
                  "errorWeight": -0.193981926474,
                  "absErrorWeight": 0.193981926474
                }
              }
            },
            "day15": {
              "cutoffDay": 15,
              "cutoffDate": "2026-07-15",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.149866028965,
                  "errorWeight": -0.034805265029,
                  "absErrorWeight": 0.034805265029
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.149866028965,
                  "errorWeight": -0.111099636268,
                  "absErrorWeight": 0.111099636268
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.149866028965,
                  "errorWeight": 0.017391936643,
                  "absErrorWeight": 0.017391936643
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.031451665894,
                  "errorWeight": -0.139186961155,
                  "absErrorWeight": 0.139186961155
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.031451665894,
                  "errorWeight": -0.193401465634,
                  "absErrorWeight": 0.193401465634
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.031451665894,
                  "errorWeight": -0.140639405063,
                  "absErrorWeight": 0.140639405063
                }
              }
            },
            "day20": {
              "cutoffDay": 20,
              "cutoffDate": "2026-07-20",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.149866028965,
                  "errorWeight": -0.001118662337,
                  "absErrorWeight": 0.001118662337
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.149866028965,
                  "errorWeight": -0.040113323509,
                  "absErrorWeight": 0.040113323509
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.149866028965,
                  "errorWeight": 0.013629836077,
                  "absErrorWeight": 0.013629836077
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.031451665894,
                  "errorWeight": -0.094299596474,
                  "absErrorWeight": 0.094299596474
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.031451665894,
                  "errorWeight": -0.120700723015,
                  "absErrorWeight": 0.120700723015
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.031451665894,
                  "errorWeight": -0.093861873652,
                  "absErrorWeight": 0.093861873652
                }
              }
            },
            "day25": {
              "cutoffDay": 25,
              "cutoffDate": "2026-07-25",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.149866028965,
                  "errorWeight": 0.023133073061,
                  "absErrorWeight": 0.023133073061
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.149866028965,
                  "errorWeight": 0.0098965874,
                  "absErrorWeight": 0.0098965874
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.149866028965,
                  "errorWeight": 0.025678870267,
                  "absErrorWeight": 0.025678870267
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.031451665894,
                  "errorWeight": -0.031897059653,
                  "absErrorWeight": 0.031897059653
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.031451665894,
                  "errorWeight": -0.041709812356,
                  "absErrorWeight": 0.041709812356
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.031451665894,
                  "errorWeight": -0.032172760573,
                  "absErrorWeight": 0.032172760573
                }
              }
            }
          }
        },
        "2026-08": {
          "brandId": "cyj",
          "yearMonth": "2026-08",
          "evidenceType": "historical_backtest",
          "comparisonMode": "v2_vs_v1_vs_pace",
          "statisticsVersion": "normalized-wape-components-v1",
          "complete": true,
          "strategyVersion": "projection-strategy-v2-phase-calibrated",
          "sourceMonths": [
            "2026-05",
            "2026-06",
            "2026-07"
          ],
          "checkpoints": {
            "day05": {
              "cutoffDay": 5,
              "cutoffDate": "2026-08-05",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.171773031567,
                  "errorWeight": -0.362050969633,
                  "absErrorWeight": 0.362050969633
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.171773031567,
                  "errorWeight": -0.461061155099,
                  "absErrorWeight": 0.461061155099
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.171773031567,
                  "errorWeight": -0.325988714987,
                  "absErrorWeight": 0.325988714987
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.046677862505,
                  "errorWeight": -0.137574146727,
                  "absErrorWeight": 0.137574146727
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.046677862505,
                  "errorWeight": -0.300723169561,
                  "absErrorWeight": 0.300723169561
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.046677862505,
                  "errorWeight": -0.190667895402,
                  "absErrorWeight": 0.190667895402
                }
              }
            },
            "day07": {
              "cutoffDay": 7,
              "cutoffDate": "2026-08-07",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.171773031567,
                  "errorWeight": -0.343400305668,
                  "absErrorWeight": 0.343400305668
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.171773031567,
                  "errorWeight": -0.408889959075,
                  "absErrorWeight": 0.408889959075
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.171773031567,
                  "errorWeight": -0.318793059871,
                  "absErrorWeight": 0.318793059871
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.046677862505,
                  "errorWeight": -0.17775435301,
                  "absErrorWeight": 0.17775435301
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.046677862505,
                  "errorWeight": -0.304243250515,
                  "absErrorWeight": 0.304243250515
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.046677862505,
                  "errorWeight": -0.258861696395,
                  "absErrorWeight": 0.258861696395
                }
              }
            },
            "day10": {
              "cutoffDay": 10,
              "cutoffDate": "2026-08-10",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.171773031567,
                  "errorWeight": -0.318751055356,
                  "absErrorWeight": 0.318751055356
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.171773031567,
                  "errorWeight": -0.385897759931,
                  "absErrorWeight": 0.385897759931
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.171773031567,
                  "errorWeight": -0.298746329998,
                  "absErrorWeight": 0.298746329998
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.046677862505,
                  "errorWeight": -0.153360481524,
                  "absErrorWeight": 0.153360481524
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.046677862505,
                  "errorWeight": -0.251873046958,
                  "absErrorWeight": 0.251873046958
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.046677862505,
                  "errorWeight": -0.187891815396,
                  "absErrorWeight": 0.187891815396
                }
              }
            },
            "day15": {
              "cutoffDay": 15,
              "cutoffDate": "2026-08-15",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.171773031567,
                  "errorWeight": -0.253145574947,
                  "absErrorWeight": 0.253145574947
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.171773031567,
                  "errorWeight": -0.30971684882,
                  "absErrorWeight": 0.30971684882
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.171773031567,
                  "errorWeight": -0.22100576906,
                  "absErrorWeight": 0.22100576906
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.046677862505,
                  "errorWeight": -0.149413864531,
                  "absErrorWeight": 0.149413864531
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.046677862505,
                  "errorWeight": -0.203313993783,
                  "absErrorWeight": 0.203313993783
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.046677862505,
                  "errorWeight": -0.140006286439,
                  "absErrorWeight": 0.140006286439
                }
              }
            },
            "day20": {
              "cutoffDay": 20,
              "cutoffDate": "2026-08-20",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.171773031567,
                  "errorWeight": -0.160779652941,
                  "absErrorWeight": 0.160779652941
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.171773031567,
                  "errorWeight": -0.195459743316,
                  "absErrorWeight": 0.195459743316
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.171773031567,
                  "errorWeight": -0.153520991052,
                  "absErrorWeight": 0.153520991052
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.046677862505,
                  "errorWeight": -0.123635095995,
                  "absErrorWeight": 0.123635095995
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.046677862505,
                  "errorWeight": -0.149611098162,
                  "absErrorWeight": 0.149611098162
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.046677862505,
                  "errorWeight": -0.122664695875,
                  "absErrorWeight": 0.122664695875
                }
              }
            },
            "day25": {
              "cutoffDay": 25,
              "cutoffDate": "2026-08-25",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.171773031567,
                  "errorWeight": -0.101966170846,
                  "absErrorWeight": 0.101966170846
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.171773031567,
                  "errorWeight": -0.114066647085,
                  "absErrorWeight": 0.114066647085
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.171773031567,
                  "errorWeight": -0.100243596229,
                  "absErrorWeight": 0.100243596229
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.046677862505,
                  "errorWeight": -0.087217457496,
                  "absErrorWeight": 0.087217457496
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.046677862505,
                  "errorWeight": -0.096659581438,
                  "absErrorWeight": 0.096659581438
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.046677862505,
                  "errorWeight": -0.088044453717,
                  "absErrorWeight": 0.088044453717
                }
              }
            }
          }
        }
      }
    },
    "anniu": {
      "brandId": "anniu",
      "rawRowCount": 3519,
      "estimatedBilledReads": 3521,
      "months": {
        "2026-05": {
          "brandId": "anniu",
          "yearMonth": "2026-05",
          "evidenceType": "historical_backtest",
          "comparisonMode": "v2_vs_v1_vs_pace",
          "statisticsVersion": "normalized-wape-components-v1",
          "complete": true,
          "strategyVersion": "projection-strategy-v2-phase-calibrated",
          "sourceMonths": [
            "2026-02",
            "2026-03",
            "2026-04"
          ],
          "checkpoints": {
            "day05": {
              "cutoffDay": 5,
              "cutoffDate": "2026-05-05",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.027911053885,
                  "absErrorWeight": 0.027911053885
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.215701339464,
                  "absErrorWeight": 0.215701339464
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.243493187945,
                  "absErrorWeight": 0.243493187945
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.155185982407,
                  "absErrorWeight": 0.155185982407
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.268009157413,
                  "absErrorWeight": 0.268009157413
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.254562965112,
                  "absErrorWeight": 0.254562965112
                }
              }
            },
            "day07": {
              "cutoffDay": 7,
              "cutoffDate": "2026-05-07",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.00593073284,
                  "absErrorWeight": 0.00593073284
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.180014477959,
                  "absErrorWeight": 0.180014477959
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.166364775928,
                  "absErrorWeight": 0.166364775928
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.143421094619,
                  "absErrorWeight": 0.143421094619
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.237106341598,
                  "absErrorWeight": 0.237106341598
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.205277388762,
                  "absErrorWeight": 0.205277388762
                }
              }
            },
            "day10": {
              "cutoffDay": 10,
              "cutoffDate": "2026-05-10",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": 0.068479932634,
                  "absErrorWeight": 0.068479932634
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.057451444996,
                  "absErrorWeight": 0.057451444996
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": 0.014806659116,
                  "absErrorWeight": 0.014806659116
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.142190587761,
                  "absErrorWeight": 0.142190587761
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.200991932489,
                  "absErrorWeight": 0.200991932489
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.164468045279,
                  "absErrorWeight": 0.164468045279
                }
              }
            },
            "day15": {
              "cutoffDay": 15,
              "cutoffDate": "2026-05-15",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.018144814191,
                  "absErrorWeight": 0.018144814191
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.076235272208,
                  "absErrorWeight": 0.076235272208
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.032678524612,
                  "absErrorWeight": 0.032678524612
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.092403814427,
                  "absErrorWeight": 0.092403814427
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.13006287086,
                  "absErrorWeight": 0.13006287086
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.071670839744,
                  "absErrorWeight": 0.071670839744
                }
              }
            },
            "day20": {
              "cutoffDay": 20,
              "cutoffDate": "2026-05-20",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.046047047248,
                  "absErrorWeight": 0.046047047248
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.077851750905,
                  "absErrorWeight": 0.077851750905
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.065809302972,
                  "absErrorWeight": 0.065809302972
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.092561822245,
                  "absErrorWeight": 0.092561822245
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.101364170354,
                  "absErrorWeight": 0.101364170354
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.080129801301,
                  "absErrorWeight": 0.080129801301
                }
              }
            },
            "day25": {
              "cutoffDay": 25,
              "cutoffDate": "2026-05-25",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.097374291333,
                  "absErrorWeight": 0.097374291333
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.102388869458,
                  "absErrorWeight": 0.102388869458
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.099993797468,
                  "absErrorWeight": 0.099993797468
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.063407257832,
                  "absErrorWeight": 0.063407257832
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.069904856462,
                  "absErrorWeight": 0.069904856462
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.0,
                  "errorWeight": -0.063897565666,
                  "absErrorWeight": 0.063897565666
                }
              }
            }
          }
        },
        "2026-06": {
          "brandId": "anniu",
          "yearMonth": "2026-06",
          "evidenceType": "historical_backtest",
          "comparisonMode": "v2_vs_v1_vs_pace",
          "statisticsVersion": "normalized-wape-components-v1",
          "complete": true,
          "strategyVersion": "projection-strategy-v2-phase-calibrated",
          "sourceMonths": [
            "2026-03",
            "2026-04",
            "2026-05"
          ],
          "checkpoints": {
            "day05": {
              "cutoffDay": 5,
              "cutoffDate": "2026-06-05",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.984576938997,
                  "errorWeight": -0.05511296296,
                  "absErrorWeight": 0.05511296296
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.984576938997,
                  "errorWeight": -0.266184641592,
                  "absErrorWeight": 0.266184641592
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.984576938997,
                  "errorWeight": -0.135101652424,
                  "absErrorWeight": 0.135101652424
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.001295118009,
                  "errorWeight": -0.092150403178,
                  "absErrorWeight": 0.092150403178
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.001295118009,
                  "errorWeight": -0.236525367608,
                  "absErrorWeight": 0.236525367608
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.001295118009,
                  "errorWeight": -0.118958931455,
                  "absErrorWeight": 0.118958931455
                }
              }
            },
            "day07": {
              "cutoffDay": 7,
              "cutoffDate": "2026-06-07",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.984576938997,
                  "errorWeight": -0.016824299093,
                  "absErrorWeight": 0.016824299093
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.984576938997,
                  "errorWeight": -0.200676054284,
                  "absErrorWeight": 0.200676054284
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.984576938997,
                  "errorWeight": -0.102175368169,
                  "absErrorWeight": 0.102175368169
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.001295118009,
                  "errorWeight": -0.046887463101,
                  "absErrorWeight": 0.046887463101
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.001295118009,
                  "errorWeight": -0.21129800314,
                  "absErrorWeight": 0.21129800314
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.001295118009,
                  "errorWeight": -0.151864429752,
                  "absErrorWeight": 0.151864429752
                }
              }
            },
            "day10": {
              "cutoffDay": 10,
              "cutoffDate": "2026-06-10",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.984576938997,
                  "errorWeight": -0.112907084668,
                  "absErrorWeight": 0.112907084668
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.984576938997,
                  "errorWeight": -0.231113560789,
                  "absErrorWeight": 0.231113560789
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.984576938997,
                  "errorWeight": -0.172443847748,
                  "absErrorWeight": 0.172443847748
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.001295118009,
                  "errorWeight": -0.106328964843,
                  "absErrorWeight": 0.106328964843
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.001295118009,
                  "errorWeight": -0.192092963734,
                  "absErrorWeight": 0.192092963734
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.001295118009,
                  "errorWeight": -0.133880356861,
                  "absErrorWeight": 0.133880356861
                }
              }
            },
            "day15": {
              "cutoffDay": 15,
              "cutoffDate": "2026-06-15",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.984576938997,
                  "errorWeight": -0.072995543898,
                  "absErrorWeight": 0.072995543898
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.984576938997,
                  "errorWeight": -0.136792486966,
                  "absErrorWeight": 0.136792486966
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.984576938997,
                  "errorWeight": -0.062041971173,
                  "absErrorWeight": 0.062041971173
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.001295118009,
                  "errorWeight": -0.106196156689,
                  "absErrorWeight": 0.106196156689
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.001295118009,
                  "errorWeight": -0.156160906767,
                  "absErrorWeight": 0.156160906767
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.001295118009,
                  "errorWeight": -0.105237681197,
                  "absErrorWeight": 0.105237681197
                }
              }
            },
            "day20": {
              "cutoffDay": 20,
              "cutoffDate": "2026-06-20",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.984576938997,
                  "errorWeight": -0.048306794084,
                  "absErrorWeight": 0.048306794084
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.984576938997,
                  "errorWeight": -0.077994809813,
                  "absErrorWeight": 0.077994809813
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.984576938997,
                  "errorWeight": -0.044315307673,
                  "absErrorWeight": 0.044315307673
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.001295118009,
                  "errorWeight": -0.065833005178,
                  "absErrorWeight": 0.065833005178
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.001295118009,
                  "errorWeight": -0.100922057701,
                  "absErrorWeight": 0.100922057701
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.001295118009,
                  "errorWeight": -0.077447221342,
                  "absErrorWeight": 0.077447221342
                }
              }
            },
            "day25": {
              "cutoffDay": 25,
              "cutoffDate": "2026-06-25",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.984576938997,
                  "errorWeight": -0.031973448565,
                  "absErrorWeight": 0.031973448565
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.984576938997,
                  "errorWeight": -0.041500873681,
                  "absErrorWeight": 0.041500873681
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.984576938997,
                  "errorWeight": -0.032946100056,
                  "absErrorWeight": 0.032946100056
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.001295118009,
                  "errorWeight": -0.029755737612,
                  "absErrorWeight": 0.029755737612
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.001295118009,
                  "errorWeight": -0.042130121725,
                  "absErrorWeight": 0.042130121725
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.001295118009,
                  "errorWeight": -0.034339247359,
                  "absErrorWeight": 0.034339247359
                }
              }
            }
          }
        },
        "2026-07": {
          "brandId": "anniu",
          "yearMonth": "2026-07",
          "evidenceType": "historical_backtest",
          "comparisonMode": "v2_vs_v1_vs_pace",
          "statisticsVersion": "normalized-wape-components-v1",
          "complete": true,
          "strategyVersion": "projection-strategy-v2-phase-calibrated",
          "sourceMonths": [
            "2026-04",
            "2026-05",
            "2026-06"
          ],
          "checkpoints": {
            "day05": {
              "cutoffDay": 5,
              "cutoffDate": "2026-07-05",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.858390471742,
                  "errorWeight": 0.09396724684,
                  "absErrorWeight": 0.09396724684
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.858390471742,
                  "errorWeight": -0.104418871017,
                  "absErrorWeight": 0.104418871017
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.858390471742,
                  "errorWeight": -0.005223886415,
                  "absErrorWeight": 0.005223886415
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.880996294728,
                  "errorWeight": -0.010554645933,
                  "absErrorWeight": 0.010554645933
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.880996294728,
                  "errorWeight": -0.126003685204,
                  "absErrorWeight": 0.126003685204
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.880996294728,
                  "errorWeight": -0.081224999778,
                  "absErrorWeight": 0.081224999778
                }
              }
            },
            "day07": {
              "cutoffDay": 7,
              "cutoffDate": "2026-07-07",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.858390471742,
                  "errorWeight": 0.057146163622,
                  "absErrorWeight": 0.057146163622
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.858390471742,
                  "errorWeight": -0.062783790314,
                  "absErrorWeight": 0.062783790314
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.858390471742,
                  "errorWeight": 0.003636448118,
                  "absErrorWeight": 0.003636448118
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.880996294728,
                  "errorWeight": -0.022731676538,
                  "absErrorWeight": 0.022731676538
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.880996294728,
                  "errorWeight": -0.116708232954,
                  "absErrorWeight": 0.116708232954
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.880996294728,
                  "errorWeight": -0.088133129236,
                  "absErrorWeight": 0.088133129236
                }
              }
            },
            "day10": {
              "cutoffDay": 10,
              "cutoffDate": "2026-07-10",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.858390471742,
                  "errorWeight": -0.003359834432,
                  "absErrorWeight": 0.003359834432
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.858390471742,
                  "errorWeight": -0.090941423589,
                  "absErrorWeight": 0.090941423589
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.858390471742,
                  "errorWeight": -0.046623569058,
                  "absErrorWeight": 0.046623569058
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.880996294728,
                  "errorWeight": -0.054479010094,
                  "absErrorWeight": 0.054479010094
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.880996294728,
                  "errorWeight": -0.114205899682,
                  "absErrorWeight": 0.114205899682
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.880996294728,
                  "errorWeight": -0.085004784975,
                  "absErrorWeight": 0.085004784975
                }
              }
            },
            "day15": {
              "cutoffDay": 15,
              "cutoffDate": "2026-07-15",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.858390471742,
                  "errorWeight": -0.098569917184,
                  "absErrorWeight": 0.098569917184
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.858390471742,
                  "errorWeight": -0.111280635952,
                  "absErrorWeight": 0.111280635952
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.858390471742,
                  "errorWeight": -0.09194929627,
                  "absErrorWeight": 0.09194929627
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.880996294728,
                  "errorWeight": -0.100447113109,
                  "absErrorWeight": 0.100447113109
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.880996294728,
                  "errorWeight": -0.131615183357,
                  "absErrorWeight": 0.131615183357
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.880996294728,
                  "errorWeight": -0.123615638662,
                  "absErrorWeight": 0.123615638662
                }
              }
            },
            "day20": {
              "cutoffDay": 20,
              "cutoffDate": "2026-07-20",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.858390471742,
                  "errorWeight": -0.065827068864,
                  "absErrorWeight": 0.065827068864
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.858390471742,
                  "errorWeight": -0.069467647862,
                  "absErrorWeight": 0.069467647862
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.858390471742,
                  "errorWeight": -0.058173137742,
                  "absErrorWeight": 0.058173137742
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.880996294728,
                  "errorWeight": -0.033672476078,
                  "absErrorWeight": 0.033672476078
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.880996294728,
                  "errorWeight": -0.05854066308,
                  "absErrorWeight": 0.05854066308
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.880996294728,
                  "errorWeight": -0.048684765026,
                  "absErrorWeight": 0.048684765026
                }
              }
            },
            "day25": {
              "cutoffDay": 25,
              "cutoffDate": "2026-07-25",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.858390471742,
                  "errorWeight": -0.03681437442,
                  "absErrorWeight": 0.03681437442
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.858390471742,
                  "errorWeight": -0.037007811433,
                  "absErrorWeight": 0.037007811433
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.858390471742,
                  "errorWeight": -0.032418185974,
                  "absErrorWeight": 0.032418185974
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.880996294728,
                  "errorWeight": -0.027325351685,
                  "absErrorWeight": 0.027325351685
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.880996294728,
                  "errorWeight": -0.033321588842,
                  "absErrorWeight": 0.033321588842
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.880996294728,
                  "errorWeight": -0.030334211374,
                  "absErrorWeight": 0.030334211374
                }
              }
            }
          }
        },
        "2026-08": {
          "brandId": "anniu",
          "yearMonth": "2026-08",
          "evidenceType": "historical_backtest",
          "comparisonMode": "v2_vs_v1_vs_pace",
          "statisticsVersion": "normalized-wape-components-v1",
          "complete": true,
          "strategyVersion": "projection-strategy-v2-phase-calibrated",
          "sourceMonths": [
            "2026-05",
            "2026-06",
            "2026-07"
          ],
          "checkpoints": {
            "day05": {
              "cutoffDay": 5,
              "cutoffDate": "2026-08-05",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.012341020508,
                  "errorWeight": -0.2669120803,
                  "absErrorWeight": 0.2669120803
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.012341020508,
                  "errorWeight": -0.335935270286,
                  "absErrorWeight": 0.335935270286
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.012341020508,
                  "errorWeight": -0.336370503564,
                  "absErrorWeight": 0.336370503564
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.953823555633,
                  "errorWeight": -0.141522368979,
                  "absErrorWeight": 0.141522368979
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.953823555633,
                  "errorWeight": -0.204519063086,
                  "absErrorWeight": 0.204519063086
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.953823555633,
                  "errorWeight": -0.153925571508,
                  "absErrorWeight": 0.153925571508
                }
              }
            },
            "day07": {
              "cutoffDay": 7,
              "cutoffDate": "2026-08-07",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.012341020508,
                  "errorWeight": -0.250206116952,
                  "absErrorWeight": 0.250206116952
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.012341020508,
                  "errorWeight": -0.294090197989,
                  "absErrorWeight": 0.294090197989
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.012341020508,
                  "errorWeight": -0.266929442421,
                  "absErrorWeight": 0.266929442421
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.953823555633,
                  "errorWeight": -0.099800146263,
                  "absErrorWeight": 0.099800146263
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.953823555633,
                  "errorWeight": -0.182455506637,
                  "absErrorWeight": 0.182455506637
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.953823555633,
                  "errorWeight": -0.138284047592,
                  "absErrorWeight": 0.138284047592
                }
              }
            },
            "day10": {
              "cutoffDay": 10,
              "cutoffDate": "2026-08-10",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.012341020508,
                  "errorWeight": -0.231695642204,
                  "absErrorWeight": 0.231695642204
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.012341020508,
                  "errorWeight": -0.260240087386,
                  "absErrorWeight": 0.260240087386
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.012341020508,
                  "errorWeight": -0.221496840327,
                  "absErrorWeight": 0.221496840327
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.953823555633,
                  "errorWeight": -0.125184597412,
                  "absErrorWeight": 0.125184597412
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.953823555633,
                  "errorWeight": -0.18512611182,
                  "absErrorWeight": 0.18512611182
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.953823555633,
                  "errorWeight": -0.15760146566,
                  "absErrorWeight": 0.15760146566
                }
              }
            },
            "day15": {
              "cutoffDay": 15,
              "cutoffDate": "2026-08-15",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.012341020508,
                  "errorWeight": -0.19574387635,
                  "absErrorWeight": 0.19574387635
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.012341020508,
                  "errorWeight": -0.209020059834,
                  "absErrorWeight": 0.209020059834
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.012341020508,
                  "errorWeight": -0.16432312715,
                  "absErrorWeight": 0.16432312715
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.953823555633,
                  "errorWeight": -0.073989537862,
                  "absErrorWeight": 0.073989537862
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.953823555633,
                  "errorWeight": -0.107732842762,
                  "absErrorWeight": 0.107732842762
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.953823555633,
                  "errorWeight": -0.061959922006,
                  "absErrorWeight": 0.061959922006
                }
              }
            },
            "day20": {
              "cutoffDay": 20,
              "cutoffDate": "2026-08-20",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.012341020508,
                  "errorWeight": -0.12802846717,
                  "absErrorWeight": 0.12802846717
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.012341020508,
                  "errorWeight": -0.148583789798,
                  "absErrorWeight": 0.148583789798
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.012341020508,
                  "errorWeight": -0.125793940446,
                  "absErrorWeight": 0.125793940446
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.953823555633,
                  "errorWeight": -0.064071693375,
                  "absErrorWeight": 0.064071693375
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.953823555633,
                  "errorWeight": -0.081392416348,
                  "absErrorWeight": 0.081392416348
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.953823555633,
                  "errorWeight": -0.060532127434,
                  "absErrorWeight": 0.060532127434
                }
              }
            },
            "day25": {
              "cutoffDay": 25,
              "cutoffDate": "2026-08-25",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.012341020508,
                  "errorWeight": -0.101569184776,
                  "absErrorWeight": 0.101569184776
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.012341020508,
                  "errorWeight": -0.108224281457,
                  "absErrorWeight": 0.108224281457
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.012341020508,
                  "errorWeight": -0.101494021389,
                  "absErrorWeight": 0.101494021389
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.953823555633,
                  "errorWeight": -0.051820511277,
                  "absErrorWeight": 0.051820511277
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.953823555633,
                  "errorWeight": -0.057829117982,
                  "absErrorWeight": 0.057829117982
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.953823555633,
                  "errorWeight": -0.051730075405,
                  "absErrorWeight": 0.051730075405
                }
              }
            }
          }
        }
      }
    }
  }
}
);
