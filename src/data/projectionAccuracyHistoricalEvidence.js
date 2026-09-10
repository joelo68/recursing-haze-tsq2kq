// Immutable presentation snapshot generated from the approved B2A0 production read-only backtest.
// This is historical audit evidence only. It is not a live projection_accuracy checkpoint,
// does not write Firestore, and must not be used as Projection calculation authority.

const deepFreezeEvidence = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreezeEvidence);
  return Object.freeze(value);
};

export const PROJECTION_ACCURACY_HISTORICAL_EVIDENCE = deepFreezeEvidence(
{
  "evidenceVersion": "projection-accuracy-historical-evidence-v1",
  "auditSchemaVersion": "projection-accuracy-historical-backtest-readonly-v1",
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
      "rawRowCount": 6624,
      "trustedMonthCount": 4,
      "estimatedBilledReads": 6626,
      "metrics": {
        "cash": {
          "overall": {
            "effective": {
              "count": 24,
              "wapePct": 11.0574,
              "biasPct": -7.703
            },
            "shadowV1": {
              "count": 24,
              "wapePct": 17.5465,
              "biasPct": -17.4708
            },
            "currentPace": {
              "count": 24,
              "wapePct": 12.5229,
              "biasPct": -12.0068
            }
          },
          "day05": {
            "effective": {
              "count": 4,
              "wapePct": 18.3651,
              "biasPct": -2.2582
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 27.862,
              "biasPct": -27.862
            },
            "currentPace": {
              "count": 4,
              "wapePct": 18.9454,
              "biasPct": -18.9454
            }
          },
          "day07": {
            "effective": {
              "count": 4,
              "wapePct": 11.4779,
              "biasPct": -8.5209
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 21.7796,
              "biasPct": -21.7796
            },
            "currentPace": {
              "count": 4,
              "wapePct": 14.1053,
              "biasPct": -14.1053
            }
          },
          "day10": {
            "effective": {
              "count": 4,
              "wapePct": 9.5147,
              "biasPct": -9.5147
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 20.1798,
              "biasPct": -20.1798
            },
            "currentPace": {
              "count": 4,
              "wapePct": 13.6619,
              "biasPct": -13.1702
            }
          },
          "day15": {
            "effective": {
              "count": 4,
              "wapePct": 11.5481,
              "biasPct": -11.5481
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 17.2121,
              "biasPct": -17.2121
            },
            "currentPace": {
              "count": 4,
              "wapePct": 12.2554,
              "biasPct": -11.4565
            }
          },
          "day20": {
            "effective": {
              "count": 4,
              "wapePct": 8.8123,
              "biasPct": -8.8123
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 11.7128,
              "biasPct": -11.7128
            },
            "currentPace": {
              "count": 4,
              "wapePct": 9.7431,
              "biasPct": -9.117
            }
          },
          "day25": {
            "effective": {
              "count": 4,
              "wapePct": 6.6264,
              "biasPct": -5.5638
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 6.5327,
              "biasPct": -6.0782
            },
            "currentPace": {
              "count": 4,
              "wapePct": 6.4261,
              "biasPct": -5.2466
            }
          }
        },
        "accrual": {
          "overall": {
            "effective": {
              "count": 24,
              "wapePct": 8.8523,
              "biasPct": -7.6858
            },
            "shadowV1": {
              "count": 24,
              "wapePct": 18.2863,
              "biasPct": -18.2863
            },
            "currentPace": {
              "count": 24,
              "wapePct": 14.566,
              "biasPct": -14.566
            }
          },
          "day05": {
            "effective": {
              "count": 4,
              "wapePct": 9.0834,
              "biasPct": -2.7276
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 26.9761,
              "biasPct": -26.9761
            },
            "currentPace": {
              "count": 4,
              "wapePct": 21.1486,
              "biasPct": -21.1486
            }
          },
          "day07": {
            "effective": {
              "count": 4,
              "wapePct": 6.7013,
              "biasPct": -6.0578
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 24.1855,
              "biasPct": -24.1855
            },
            "currentPace": {
              "count": 4,
              "wapePct": 19.9189,
              "biasPct": -19.9189
            }
          },
          "day10": {
            "effective": {
              "count": 4,
              "wapePct": 10.3458,
              "biasPct": -10.3458
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 21.8036,
              "biasPct": -21.8036
            },
            "currentPace": {
              "count": 4,
              "wapePct": 17.2356,
              "biasPct": -17.2356
            }
          },
          "day15": {
            "effective": {
              "count": 4,
              "wapePct": 11.3344,
              "biasPct": -11.3344
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 17.3903,
              "biasPct": -17.3903
            },
            "currentPace": {
              "count": 4,
              "wapePct": 12.654,
              "biasPct": -12.654
            }
          },
          "day20": {
            "effective": {
              "count": 4,
              "wapePct": 9.1991,
              "biasPct": -9.1991
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 12.0871,
              "biasPct": -12.0871
            },
            "currentPace": {
              "count": 4,
              "wapePct": 9.8688,
              "biasPct": -9.8688
            }
          },
          "day25": {
            "effective": {
              "count": 4,
              "wapePct": 6.45,
              "biasPct": -6.45
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 7.2752,
              "biasPct": -7.2752
            },
            "currentPace": {
              "count": 4,
              "wapePct": 6.5702,
              "biasPct": -6.5702
            }
          }
        }
      }
    },
    "anniu": {
      "rawRowCount": 3519,
      "trustedMonthCount": 4,
      "estimatedBilledReads": 3521,
      "metrics": {
        "cash": {
          "overall": {
            "effective": {
              "count": 24,
              "wapePct": 9.2161,
              "biasPct": -7.3174
            },
            "shadowV1": {
              "count": 24,
              "wapePct": 15.1129,
              "biasPct": -15.1129
            },
            "currentPace": {
              "count": 24,
              "wapePct": 11.3549,
              "biasPct": -11.1955
            }
          },
          "day05": {
            "effective": {
              "count": 4,
              "wapePct": 11.5141,
              "biasPct": -6.6394
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 23.9213,
              "biasPct": -23.9213
            },
            "currentPace": {
              "count": 4,
              "wapePct": 18.6805,
              "biasPct": -18.6805
            }
          },
          "day07": {
            "effective": {
              "count": 4,
              "wapePct": 8.5624,
              "biasPct": -5.5979
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 19.1311,
              "biasPct": -19.1311
            },
            "currentPace": {
              "count": 4,
              "wapePct": 13.9835,
              "biasPct": -13.7948
            }
          },
          "day10": {
            "effective": {
              "count": 4,
              "wapePct": 10.8018,
              "biasPct": -7.2493
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 16.5939,
              "biasPct": -16.5939
            },
            "currentPace": {
              "count": 4,
              "wapePct": 11.8115,
              "biasPct": -11.0434
            }
          },
          "day15": {
            "effective": {
              "count": 4,
              "wapePct": 9.998,
              "biasPct": -9.998
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 13.8336,
              "biasPct": -13.8336
            },
            "currentPace": {
              "count": 4,
              "wapePct": 9.1041,
              "biasPct": -9.1041
            }
          },
          "day20": {
            "effective": {
              "count": 4,
              "wapePct": 7.4757,
              "biasPct": -7.4757
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 9.6983,
              "biasPct": -9.6983
            },
            "currentPace": {
              "count": 4,
              "wapePct": 7.6282,
              "biasPct": -7.6282
            }
          },
          "day25": {
            "effective": {
              "count": 4,
              "wapePct": 6.9445,
              "biasPct": -6.9445
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 7.4993,
              "biasPct": -7.4993
            },
            "currentPace": {
              "count": 4,
              "wapePct": 6.9217,
              "biasPct": -6.9217
            }
          }
        },
        "accrual": {
          "overall": {
            "effective": {
              "count": 24,
              "wapePct": 8.437,
              "biasPct": -8.437
            },
            "shadowV1": {
              "count": 24,
              "wapePct": 14.5374,
              "biasPct": -14.5374
            },
            "currentPace": {
              "count": 24,
              "wapePct": 11.0475,
              "biasPct": -11.0475
            }
          },
          "day05": {
            "effective": {
              "count": 4,
              "wapePct": 10.4119,
              "biasPct": -10.4119
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 21.7683,
              "biasPct": -21.7683
            },
            "currentPace": {
              "count": 4,
              "wapePct": 15.8669,
              "biasPct": -15.8669
            }
          },
          "day07": {
            "effective": {
              "count": 4,
              "wapePct": 8.1551,
              "biasPct": -8.1551
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 19.4876,
              "biasPct": -19.4876
            },
            "currentPace": {
              "count": 4,
              "wapePct": 15.2122,
              "biasPct": -15.2122
            }
          },
          "day10": {
            "effective": {
              "count": 4,
              "wapePct": 11.1619,
              "biasPct": -11.1619
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 18.05,
              "biasPct": -18.05
            },
            "currentPace": {
              "count": 4,
              "wapePct": 14.1016,
              "biasPct": -14.1016
            }
          },
          "day15": {
            "effective": {
              "count": 4,
              "wapePct": 9.7243,
              "biasPct": -9.7243
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 13.7006,
              "biasPct": -13.7006
            },
            "currentPace": {
              "count": 4,
              "wapePct": 9.4492,
              "biasPct": -9.4492
            }
          },
          "day20": {
            "effective": {
              "count": 4,
              "wapePct": 6.677,
              "biasPct": -6.677
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 8.921,
              "biasPct": -8.921
            },
            "currentPace": {
              "count": 4,
              "wapePct": 6.9548,
              "biasPct": -6.9548
            }
          },
          "day25": {
            "effective": {
              "count": 4,
              "wapePct": 4.4918,
              "biasPct": -4.4918
            },
            "shadowV1": {
              "count": 4,
              "wapePct": 5.2967,
              "biasPct": -5.2967
            },
            "currentPace": {
              "count": 4,
              "wapePct": 4.7001,
              "biasPct": -4.7001
            }
          }
        }
      }
    }
  }
}
);
