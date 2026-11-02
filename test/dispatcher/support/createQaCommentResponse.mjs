export function createQaCommentResponse() {
  const head = '43bc61cc0c7b0476f668a6e4f3a920386497f329';
  return {
    number: 109,

    state: 'OPEN',

    baseRefName: 'main',

    headRefName: 'codex/issue-100-6224',

    headRefOid: head,

    body: 'Closes #100',

    mergeStateStatus: 'CLEAN',

    mergeable: 'MERGEABLE',

    reviews: createQaReviews(),
    comments: createQaComments(head),

    statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  };
}

function createQaReviews() {
  return [
    {
      body: '[QA/SDET Review] round=1 verdict=changes_requested',
      commit: { oid: '58787024de7f99884f00d57480bc76edf66cb2a1' },
      submittedAt: '2026-09-30T16:24:27Z',
    },
    {
      body: '[QA/SDET Review] round=2 verdict=changes_requested',
      commit: { oid: '497a24db1037c4a1da331b18d4ef0922a29031a7' },
      submittedAt: '2026-09-30T16:33:03Z',
    },
  ];
}

function createQaComments(head) {
  return [
    {
      body: `[Worker] round=2 status=ready_for_review pr=109 base=main commit=${head}\n\n[Human Verification]\n1. Load configuration with an unknown key.\n2. Confirm it warns and loads successfully.`,
      createdAt: '2026-10-01T08:47:27Z',
    },
    {
      body: `[QA/SDET Review] round=2 verdict=passed\n\ncommit=${head}\n\n- [Q1] pass - Unknown keys warn and are ignored.`,
      createdAt: '2026-10-01T08:48:42Z',
    },
  ];
}
