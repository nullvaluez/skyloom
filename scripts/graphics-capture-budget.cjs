/* Pure fixed-pose gate; texture storage is distinct from total GPU memory. */
function captureBudgetChecks(shots, auditTextures = false) {
  return shots.map(s => {
    const audit = s.textureAudit;
    const allocationObserved = audit?.peakComplete === true && audit.contexts > 0 && audit.created > 0 &&
      Number.isFinite(audit.peakBytes) && audit.peakBytes > 0 &&
      Number.isFinite(audit.currentBytes) && audit.currentBytes > 0;
    const drawLimit = s.name === 'owens' ? 261 : 375;
    const textureLimitBytes = 300 * 1048576;
    return { file: s.file, draws: s.review?.drawCalls, triangles: s.review?.triangles,
      drawLimit, triangleLimit: 2000000,
      textureBytes: audit?.currentBytes, peakTextureBytes: audit?.peakBytes,
      combinedAllocationBytes: audit?.combinedBytes, peakCombinedAllocationBytes: audit?.peakCombinedBytes,
      textureLimitBytes, allocationObserved,
      pass: s.review?.drawCalls > 1 && s.review.drawCalls <= drawLimit &&
        s.review?.triangles > 0 && s.review.triangles <= 2000000 &&
        (!auditTextures || (allocationObserved && audit.peakBytes <= textureLimitBytes)) };
  });
}
module.exports = { captureBudgetChecks };
