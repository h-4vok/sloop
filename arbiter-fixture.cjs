let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  const context = JSON.parse(input);
  process.stdout.write(
    JSON.stringify({
      id: `fixture-${context.issue.number}-${Date.now()}`,
      sessionId: context.session.sessionId,
      issue: context.issue.number,
      role: 'arbiter',
      round: context.session.round,
      type: 'clarification_requested',
      payload: { question: 'Could you clarify the remaining safety evidence in plain language?' },
      emittedAt: new Date().toISOString(),
    }) + '\n',
  );
});
