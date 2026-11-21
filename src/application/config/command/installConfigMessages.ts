/** Provides the user-facing text for the config install command. */
export const installConfigMessages = Object.freeze({
  missingConfiguration: 'No valid sloop.config.yaml; run sloop config init',

  requiresTerminal:
    'sloop config install requires a TTY; use --force for non-interactive installation',

  confirmationPrompt: 'Install configured GitHub labels and Sloop skills now? [Y/n] ',

  installationSkipped: 'Installation skipped.',

  synchronizationFailed: (message: string) => `Synchronization failed: ${message}`,
});
