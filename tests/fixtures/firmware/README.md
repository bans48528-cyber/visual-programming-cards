# Historical signed firmware fixtures

These original signed packages are regression inputs, outside the active App assets. The APK includes only the current package declared by `assets/firmware/release.json`.

| Package | SHA-256 |
| --- | --- |
| `xiaobai_py32_1.0.0.ota` | `e9072a07aa4494351a0e7ca2253216193c3c7b97c6d05309a901eeefee1cd9d4` |
| `xiaobai_py32_1.0.3.ota` | `a4951259ca4ca31cf0ec1acad5ea6e1b1f232d1989e93b86170e074d3a7178d9` |

Session tests use these repository-local fixtures by default. An explicit `XIAOBAI_FIRMWARE_ROOT` still permits testing the historical package from a firmware checkout.
