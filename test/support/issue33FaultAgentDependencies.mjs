export const createFaultAgentDependencies = ({
  events,
  comments,
  reviews,
  pr,
  pullRequestEvidence,
}) => ({
  run: async (spec) => {
    if (spec.input?.includes('Use the worker skill')) {
      events.push({ type: 'worker' });
      spec.onStart?.(7002);
      comments.push({
        body: `[Worker] round=1 status=ready_for_review pr=14 base=main commit=abcdef2\n\n[Human Verification]\n\`\`\`json\n{"summary":"fault","steps":["run"],"expected":["pass"],"isolation":"temp","limitations":["none"],"checklist":["pass"]}\n\`\`\``,
      });
      pr.headRefOid = 'abcdef2';
      return 'WORKER_RESULT pr=14 base=main';
    }
    if (spec.input?.includes('Use the sloop-qa skill')) {
      reviews.push({
        body: '[QA/SDET Review] round=1 verdict=passed commit=abcdef2',

        commitId: 'abcdef2',

        submittedAt: '1',
      });
      return 'QA_RESULT';
    }
    return 'ok';
  },

  pullRequest: (number) => {
    events.push({ type: 'pullRequest', number });
    return structuredClone({ ...pr, ...pullRequestEvidence });
  },

  updatePullRequestBody: (_number, body) => {
    pr.body = body;
  },

  pullRequestBody: () => pr.body,

  prComment: (_number, body) => comments.push({ body }),
});
