type RuntimeModule = typeof import('../../runtime.js');
type DispatcherModule = typeof import('../../dispatcher.js');
type AdaptersModule = typeof import('../../adapters.js');
type ConfigWizardModule = typeof import('../../config-wizard.js');

// Defines injectable application modules so CLI behavior can be isolated in tests.
export type CliModules = Readonly<{
  runtime?: Pick<
    RuntimeModule,
    | 'emitNodeVersionFailure'
    | 'emitUsageFailure'
    | 'parseCliCommand'
    | 'runDispatcherPreflight'
    | 'runReadOnlyCommand'
    | 'discoverRepository'
  >;
  dispatcher?: Pick<DispatcherModule, 'runDispatcherCli'>;
  adapters?: Pick<AdaptersModule, 'productionDependencies'>;
  config?: Pick<ConfigWizardModule, 'runConfigCommand'> &
    Pick<AdaptersModule, 'productionConfigReconciler'>;
}>;
