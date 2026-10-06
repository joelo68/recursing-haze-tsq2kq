// Immutable normalized historical presentation evidence reconstructed on 2026-10-05
// from the current formal Projection authority after a read-only Production audit.
//
// This module is intentionally separate from projectionAccuracyHistoricalEvidence.js:
// - the original B2A0 2026-05~08 evidence stays immutable;
// - 2026-09 was reconstructed later because its natural live checkpoint set missed day05/day07;
// - no projection_accuracy / projection_accuracy_history document was backfilled;
// - only normalized WAPE components are embedded here; exact revenue totals are excluded;
// - no Firestore access or Projection calculation occurs in this module.

const deepFreezeEvidence = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreezeEvidence);
  return Object.freeze(value);
};

export const PROJECTION_ACCURACY_HISTORICAL_CURRENT_AUTHORITY_EVIDENCE = deepFreezeEvidence(
{
  "evidenceVersion": "projection-accuracy-historical-current-authority-evidence-v1",
  "auditSchemaVersion": "projection-accuracy-historical-backtest-current-authority-readonly-v1",
  "statisticsVersion": "normalized-wape-components-v1",
  "generatedAtText": "2026-10-05T10:06:54.226Z",
  "sourceHead": "040e998f5b27a3b3e53958a3e94851c48f4e271f",
  "authorityIdentity": {
    "calculationSource": "current_formal_projection_authority",
    "originalB2A0GeneratorRecovered": false,
    "originalGoldenEvidenceVersion": "projection-accuracy-historical-evidence-v2",
    "originalGoldenGeneratedAtText": "2026-09-10T02:26:11.181Z",
    "originalGoldenSourceJsonSha256": "01fd6c14e4029783be362d764087e1979a93f69d793aa5e3e6e02723e3fc4da6",
    "originalGoldenSourceReportSha256": "dd963b26acd62e006d942353f1ded132edcf57b8c6e7a9c1f1126bfb0a380afb",
    "gate": "STRICT_PARITY_FAILED_BUT_DRIFT_ATTRIBUTION_APPROVED_BY_WRAPPER"
  },
  "readWindow": {
    "startDate": "2026-06-01",
    "endDate": "2026-09-30"
  },
  "targetMonths": [
    "2026-09"
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
    "estimatedBilledReads": 5960,
    "writes": 0,
    "persistentListeners": 0,
    "polling": 0
  },
  "driftAttribution": {
    "strictGoldenEvidenceVersion": "projection-accuracy-historical-evidence-v2",
    "strictParityResult": "DATA_DRIFT_ATTRIBUTED",
    "strictParityMismatchCount": 82,
    "structuralMismatch": false,
    "cyj202607CashDelta": 63892
  },
  "brands": {
    "cyj": {
      "brandId": "cyj",
      "months": {
        "2026-09": {
          "brandId": "cyj",
          "yearMonth": "2026-09",
          "evidenceType": "historical_backtest_current_authority",
          "comparisonMode": "v2_vs_v1_vs_pace",
          "statisticsVersion": "normalized-wape-components-v1",
          "complete": true,
          "strategyVersion": "projection-strategy-v2-phase-calibrated",
          "sourceMonths": [
            "2026-06",
            "2026-07",
            "2026-08"
          ],
          "checkpoints": {
            "day05": {
              "cutoffDay": 5,
              "cutoffDate": "2026-09-05",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.516658235803,
                  "errorWeight": -0.367272712129,
                  "absErrorWeight": 0.367272712129
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.516658235803,
                  "errorWeight": -0.634664319207,
                  "absErrorWeight": 0.634664319207
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.516658235803,
                  "errorWeight": -0.363479692405,
                  "absErrorWeight": 0.363479692405
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.186182475015,
                  "errorWeight": -0.22204695375,
                  "absErrorWeight": 0.22204695375
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.186182475015,
                  "errorWeight": -0.415687017475,
                  "absErrorWeight": 0.415687017475
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.186182475015,
                  "errorWeight": -0.303047996065,
                  "absErrorWeight": 0.303047996065
                }
              }
            },
            "day07": {
              "cutoffDay": 7,
              "cutoffDate": "2026-09-07",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.516658235803,
                  "errorWeight": -0.357669047801,
                  "absErrorWeight": 0.357669047801
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.516658235803,
                  "errorWeight": -0.471541071967,
                  "absErrorWeight": 0.471541071967
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.516658235803,
                  "errorWeight": -0.248260617585,
                  "absErrorWeight": 0.248260617585
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.186182475015,
                  "errorWeight": -0.174760583542,
                  "absErrorWeight": 0.174760583542
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.186182475015,
                  "errorWeight": -0.369376667413,
                  "absErrorWeight": 0.369376667413
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.186182475015,
                  "errorWeight": -0.293126332043,
                  "absErrorWeight": 0.293126332043
                }
              }
            },
            "day10": {
              "cutoffDay": 10,
              "cutoffDate": "2026-09-10",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.516658235803,
                  "errorWeight": -0.333602857314,
                  "absErrorWeight": 0.333602857314
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.516658235803,
                  "errorWeight": -0.445096622969,
                  "absErrorWeight": 0.445096622969
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.516658235803,
                  "errorWeight": -0.258776367121,
                  "absErrorWeight": 0.258776367121
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.186182475015,
                  "errorWeight": -0.1239391634,
                  "absErrorWeight": 0.1239391634
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.186182475015,
                  "errorWeight": -0.272456194224,
                  "absErrorWeight": 0.272456194224
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.186182475015,
                  "errorWeight": -0.162532897464,
                  "absErrorWeight": 0.162532897464
                }
              }
            },
            "day15": {
              "cutoffDay": 15,
              "cutoffDate": "2026-09-15",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.516658235803,
                  "errorWeight": -0.272950614075,
                  "absErrorWeight": 0.272950614075
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.516658235803,
                  "errorWeight": -0.362089738423,
                  "absErrorWeight": 0.362089738423
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.516658235803,
                  "errorWeight": -0.204904257868,
                  "absErrorWeight": 0.204904257868
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.186182475015,
                  "errorWeight": -0.155148102747,
                  "absErrorWeight": 0.155148102747
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.186182475015,
                  "errorWeight": -0.238237051492,
                  "absErrorWeight": 0.238237051492
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.186182475015,
                  "errorWeight": -0.151770360284,
                  "absErrorWeight": 0.151770360284
                }
              }
            },
            "day20": {
              "cutoffDay": 20,
              "cutoffDate": "2026-09-20",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.516658235803,
                  "errorWeight": -0.11783785562,
                  "absErrorWeight": 0.11783785562
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.516658235803,
                  "errorWeight": -0.175629207867,
                  "absErrorWeight": 0.175629207867
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.516658235803,
                  "errorWeight": -0.100739111693,
                  "absErrorWeight": 0.100739111693
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.186182475015,
                  "errorWeight": -0.102420428216,
                  "absErrorWeight": 0.102420428216
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.186182475015,
                  "errorWeight": -0.146517526612,
                  "absErrorWeight": 0.146517526612
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.186182475015,
                  "errorWeight": -0.110276399562,
                  "absErrorWeight": 0.110276399562
                }
              }
            },
            "day25": {
              "cutoffDay": 25,
              "cutoffDate": "2026-09-25",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.516658235803,
                  "errorWeight": -0.061006135775,
                  "absErrorWeight": 0.061006135775
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.516658235803,
                  "errorWeight": -0.082936956915,
                  "absErrorWeight": 0.082936956915
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.516658235803,
                  "errorWeight": -0.064927236315,
                  "absErrorWeight": 0.064927236315
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.186182475015,
                  "errorWeight": -0.065376436433,
                  "absErrorWeight": 0.065376436433
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.186182475015,
                  "errorWeight": -0.080926330589,
                  "absErrorWeight": 0.080926330589
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.186182475015,
                  "errorWeight": -0.070769504415,
                  "absErrorWeight": 0.070769504415
                }
              }
            }
          },
          "evidenceBatchId": "current_authority_20261005_2026_09"
        }
      }
    },
    "anniu": {
      "brandId": "anniu",
      "months": {
        "2026-09": {
          "brandId": "anniu",
          "yearMonth": "2026-09",
          "evidenceType": "historical_backtest_current_authority",
          "comparisonMode": "v2_vs_v1_vs_pace",
          "statisticsVersion": "normalized-wape-components-v1",
          "complete": true,
          "strategyVersion": "projection-strategy-v2-phase-calibrated",
          "sourceMonths": [
            "2026-06",
            "2026-07",
            "2026-08"
          ],
          "checkpoints": {
            "day05": {
              "cutoffDay": 5,
              "cutoffDate": "2026-09-05",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.553965308122,
                  "errorWeight": -0.519987357643,
                  "absErrorWeight": 0.519987357643
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.553965308122,
                  "errorWeight": -0.6296157657,
                  "absErrorWeight": 0.6296157657
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.553965308122,
                  "errorWeight": -0.143715376506,
                  "absErrorWeight": 0.143715376506
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.844005160997,
                  "errorWeight": -0.14375158526,
                  "absErrorWeight": 0.14375158526
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.844005160997,
                  "errorWeight": -0.216560884002,
                  "absErrorWeight": 0.216560884002
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.844005160997,
                  "errorWeight": -0.238574666178,
                  "absErrorWeight": 0.238574666178
                }
              }
            },
            "day07": {
              "cutoffDay": 7,
              "cutoffDate": "2026-09-07",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.553965308122,
                  "errorWeight": -0.448446194212,
                  "absErrorWeight": 0.448446194212
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.553965308122,
                  "errorWeight": -0.530699320458,
                  "absErrorWeight": 0.530699320458
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.553965308122,
                  "errorWeight": -0.212896658077,
                  "absErrorWeight": 0.212896658077
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.844005160997,
                  "errorWeight": -0.12219495,
                  "absErrorWeight": 0.12219495
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.844005160997,
                  "errorWeight": -0.208661118135,
                  "absErrorWeight": 0.208661118135
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.844005160997,
                  "errorWeight": -0.193825621611,
                  "absErrorWeight": 0.193825621611
                }
              }
            },
            "day10": {
              "cutoffDay": 10,
              "cutoffDate": "2026-09-10",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.553965308122,
                  "errorWeight": -0.295965369184,
                  "absErrorWeight": 0.295965369184
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.553965308122,
                  "errorWeight": -0.432296688397,
                  "absErrorWeight": 0.432296688397
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.553965308122,
                  "errorWeight": -0.115137200978,
                  "absErrorWeight": 0.115137200978
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.844005160997,
                  "errorWeight": -0.075591525938,
                  "absErrorWeight": 0.075591525938
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.844005160997,
                  "errorWeight": -0.144534024975,
                  "absErrorWeight": 0.144534024975
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.844005160997,
                  "errorWeight": -0.085633361987,
                  "absErrorWeight": 0.085633361987
                }
              }
            },
            "day15": {
              "cutoffDay": 15,
              "cutoffDate": "2026-09-15",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.553965308122,
                  "errorWeight": -0.306381057808,
                  "absErrorWeight": 0.306381057808
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.553965308122,
                  "errorWeight": -0.380060464285,
                  "absErrorWeight": 0.380060464285
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.553965308122,
                  "errorWeight": -0.142948026661,
                  "absErrorWeight": 0.142948026661
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.844005160997,
                  "errorWeight": -0.056350726695,
                  "absErrorWeight": 0.056350726695
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.844005160997,
                  "errorWeight": -0.09674503236,
                  "absErrorWeight": 0.09674503236
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.844005160997,
                  "errorWeight": -0.037367911484,
                  "absErrorWeight": 0.037367911484
                }
              }
            },
            "day20": {
              "cutoffDay": 20,
              "cutoffDate": "2026-09-20",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.553965308122,
                  "errorWeight": -0.191698999088,
                  "absErrorWeight": 0.191698999088
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.553965308122,
                  "errorWeight": -0.231256712875,
                  "absErrorWeight": 0.231256712875
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.553965308122,
                  "errorWeight": -0.11701914309,
                  "absErrorWeight": 0.11701914309
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.844005160997,
                  "errorWeight": -0.020179503198,
                  "absErrorWeight": 0.020179503198
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.844005160997,
                  "errorWeight": -0.042936510991,
                  "absErrorWeight": 0.042936510991
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.844005160997,
                  "errorWeight": -0.006411242077,
                  "absErrorWeight": 0.006411242077
                }
              }
            },
            "day25": {
              "cutoffDay": 25,
              "cutoffDate": "2026-09-25",
              "phaseApplied": {
                "cash": true,
                "accrual": true
              },
              "cash": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 1.553965308122,
                  "errorWeight": -0.121230839587,
                  "absErrorWeight": 0.121230839587
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 1.553965308122,
                  "errorWeight": -0.13592155452,
                  "absErrorWeight": 0.13592155452
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 1.553965308122,
                  "errorWeight": -0.090895083187,
                  "absErrorWeight": 0.090895083187
                }
              },
              "accrual": {
                "effective": {
                  "eligible": true,
                  "actualWeight": 0.844005160997,
                  "errorWeight": -0.01245458879,
                  "absErrorWeight": 0.01245458879
                },
                "shadowV1": {
                  "eligible": true,
                  "actualWeight": 0.844005160997,
                  "errorWeight": -0.020984148885,
                  "absErrorWeight": 0.020984148885
                },
                "currentPace": {
                  "eligible": true,
                  "actualWeight": 0.844005160997,
                  "errorWeight": -0.002222932813,
                  "absErrorWeight": 0.002222932813
                }
              }
            }
          },
          "evidenceBatchId": "current_authority_20261005_2026_09"
        }
      }
    }
  }
}
);
