const IPFS_CID_PATTERN = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]+)$/;

/**
 * Return whether a value is a supported IPFS CID string.
 *
 * @param {unknown} value
 * @returns {value is string}
 */
export function isIpfsCid(value) {
  return typeof value === "string" && IPFS_CID_PATTERN.test(value);
}
