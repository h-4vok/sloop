type RuntimeModule = typeof import('./runtime/index.js');
type DispatcherModule = typeof import('../../dispatcher.js');
type AdaptersModule = typeof import('../../adapters.js');
type ConfigModule = typeof import('../config/runConfigCommand.js');
import type { Result } from '../../core/Result.js';
import type { CliCommand } from './CliCommand.js';

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
    | 'resultOutput'
    | 'EXIT'
  >;
  dispatcher?: Pick<DispatcherModule, 'runDispatcherCli'>;
  adapters?: Pick<AdaptersModule, 'productionDependencies'>;
  config?: Pick<ConfigModule, 'runConfigCommand'> &
    Pick<AdaptersModule, 'productionConfigReconciler'>;
}>;
