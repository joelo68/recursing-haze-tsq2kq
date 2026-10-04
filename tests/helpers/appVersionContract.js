export const EXPECTED_APP_VERSION = "3.6.2";

const escapedVersion = EXPECTED_APP_VERSION.replaceAll(".", "\\.");

export const CURRENT_APP_VERSION_SOURCE_PATTERN =
  new RegExp(`const\\s+CURRENT_APP_VERSION\\s*=\\s*"${escapedVersion}";`);

export const CURRENT_APP_VERSION_DOC_PATTERN =
  new RegExp(`CURRENT_APP_VERSION\\s*=\\s*${escapedVersion}`);
