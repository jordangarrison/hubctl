import * as Effect from 'effect/Effect'
import * as O from 'effect/Option'
import * as Stream from 'effect/Stream'
import { Argument, Flag, Prompt } from 'effect/unstable/cli'
import * as Command from 'effect/unstable/cli/Command'

import { Output } from '../output/service'
import { Enterprise } from '../services/enterprise'
import type {
  AuditLogInput,
  CreateOrgInput,
  MembersInput,
  OrganizationsInput,
  SecurityAnalysisInput,
} from '../services/enterprise'
import { emit } from './handle'

// The `enterprise` command group. Commands stay THIN: parse Flags/Arguments,
// call the `Enterprise` service, then hand the result (or typed GithubError) to
// `emit`, which renders the single envelope via `Output`. Mirrors
// lib/hubctl/enterprise.rb. Destructive ops are gated behind `--yes` (json mode
// never prompts; pretty/TTY mode asks via `Prompt.confirm`).

const enterpriseArg = Argument.string('enterprise').pipe(Argument.withDescription('Enterprise slug'))
const yesFlag = Flag.boolean('yes').pipe(Flag.withDefault(false), Flag.withDescription('Skip the confirmation prompt'))

// Resolve whether a destructive op may proceed. `--yes` short-circuits to true.
// In json mode (agents/pipes) we NEVER prompt, so without `--yes` the answer is
// false (the handler then fails with a re-run `fix`). In pretty/TTY mode we ask
// interactively via `Prompt.confirm`, treating a quit as a decline.
const confirmDestructive = (
  message: string,
  yes: boolean,
  output: typeof Output.Service
): Effect.Effect<boolean, never, Prompt.Environment> => {
  if (yes) {
    return Effect.succeed(true)
  }
  if (output.mode === 'json') {
    return Effect.succeed(false)
  }
  return Prompt.run(Prompt.confirm({ message })).pipe(Effect.orElseSucceed(() => false))
}

// === show ===

const showCommand = Command.make('show', { enterprise: enterpriseArg }).pipe(
  Command.withDescription('Show enterprise details'),
  Command.withHandler(({ enterprise }) =>
    Enterprise.pipe(
      Effect.flatMap((ent) =>
        emit('enterprise.show', ent.show(enterprise), {
          next_actions: ['hubctl enterprise stats <enterprise>', 'hubctl enterprise orgs list <enterprise>'],
        })
      )
    )
  )
)

// === orgs ===

const perPageFlag = Flag.integer('per-page').pipe(
  Flag.optional,
  Flag.withDescription('Number of organizations per page')
)

const optionalNumber = (key: string, value: O.Option<number>): Record<string, number> =>
  O.match(value, { onNone: () => ({}), onSome: (v) => ({ [key]: v }) })

const optionalField = (key: string, value: O.Option<string>): Record<string, string> =>
  O.match(value, { onNone: () => ({}), onSome: (v) => ({ [key]: v }) })

const orgsListCommand = Command.make('list', { enterprise: enterpriseArg, perPage: perPageFlag }).pipe(
  Command.withDescription('List enterprise organizations'),
  Command.withHandler(({ enterprise, perPage }) =>
    Enterprise.pipe(
      Effect.flatMap((ent) => {
        const input: OrganizationsInput = { ...optionalNumber('perPage', perPage) }
        return emit('enterprise.orgs.list', ent.organizations(enterprise, input), {
          next_actions: ['hubctl enterprise orgs create <enterprise> <login> --yes'],
        })
      })
    )
  )
)

const orgLoginArg = Argument.string('login').pipe(Argument.withDescription('Organization login'))
const displayNameFlag = Flag.string('display-name').pipe(Flag.optional, Flag.withDescription('Display name'))
const descriptionFlag = Flag.string('description').pipe(Flag.optional, Flag.withDescription('Description'))
const billingEmailFlag = Flag.string('billing-email').pipe(Flag.optional, Flag.withDescription('Billing email'))

const orgsCreateCommand = Command.make('create', {
  enterprise: enterpriseArg,
  login: orgLoginArg,
  displayName: displayNameFlag,
  description: descriptionFlag,
  billingEmail: billingEmailFlag,
  yes: yesFlag,
}).pipe(
  Command.withDescription('Create a new organization in the enterprise'),
  Command.withHandler(({ billingEmail, description, displayName, enterprise, login, yes }) =>
    Effect.gen(function* () {
      const output = yield* Output
      const ent = yield* Enterprise
      const confirmed = yield* confirmDestructive(
        `Create organization '${login}' in enterprise ${enterprise}?`,
        yes,
        output
      )

      if (confirmed) {
        const input: CreateOrgInput = {
          ...optionalField('displayName', displayName),
          ...optionalField('description', description),
          ...optionalField('billingEmail', billingEmail),
        }
        yield* emit('enterprise.orgs.create', ent.createOrganization(enterprise, login, input), {
          next_actions: ['hubctl enterprise orgs list <enterprise>'],
        })
        return
      }

      yield* output.mode === 'json'
        ? output.fail('enterprise.orgs.create', {
            code: 'confirmation_required',
            message: `Creating organization ${login} in ${enterprise} was not confirmed`,
            fix: 're-run with --yes',
          })
        : output.ok('enterprise.orgs.create', { enterprise, login, created: false, cancelled: true })
    })
  )
)

const orgArg = Argument.string('org').pipe(Argument.withDescription('Organization login'))

const orgsTransferCommand = Command.make('transfer', { enterprise: enterpriseArg, org: orgArg, yes: yesFlag }).pipe(
  Command.withDescription('Transfer an organization into the enterprise'),
  Command.withHandler(({ enterprise, org, yes }) =>
    Effect.gen(function* () {
      const output = yield* Output
      const ent = yield* Enterprise
      const confirmed = yield* confirmDestructive(
        `Transfer organization '${org}' into enterprise ${enterprise}?`,
        yes,
        output
      )

      if (confirmed) {
        yield* emit('enterprise.orgs.transfer', ent.transferOrganization(enterprise, org), {
          next_actions: ['hubctl enterprise orgs list <enterprise>'],
        })
        return
      }

      yield* output.mode === 'json'
        ? output.fail('enterprise.orgs.transfer', {
            code: 'confirmation_required',
            message: `Transferring ${org} into ${enterprise} was not confirmed`,
            fix: 're-run with --yes',
          })
        : output.ok('enterprise.orgs.transfer', { enterprise, organization: org, transferred: false, cancelled: true })
    })
  )
)

const orgsRemoveCommand = Command.make('remove', { enterprise: enterpriseArg, org: orgArg, yes: yesFlag }).pipe(
  Command.withDescription('Remove an organization from the enterprise'),
  Command.withHandler(({ enterprise, org, yes }) =>
    Effect.gen(function* () {
      const output = yield* Output
      const ent = yield* Enterprise
      const confirmed = yield* confirmDestructive(
        `Remove organization '${org}' from enterprise ${enterprise}? This cannot be undone easily.`,
        yes,
        output
      )

      if (confirmed) {
        yield* emit('enterprise.orgs.remove', ent.removeOrganization(enterprise, org), {
          next_actions: ['hubctl enterprise orgs list <enterprise>'],
        })
        return
      }

      yield* output.mode === 'json'
        ? output.fail('enterprise.orgs.remove', {
            code: 'confirmation_required',
            message: `Removing ${org} from ${enterprise} was not confirmed`,
            fix: 're-run with --yes',
          })
        : output.ok('enterprise.orgs.remove', { enterprise, organization: org, removed: false, cancelled: true })
    })
  )
)

// Project a Command down to its discoverable `{ name, description }` entry for
// the group-listing handlers below.
interface GroupEntry {
  readonly name: string
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly description: string | undefined
}

const toEntry = (command: GroupEntry): { name: string; description: string } => ({
  name: command.name,
  description: O.getOrElse(O.fromUndefinedOr(command.description), () => ''),
})

const orgsSubcommands = [orgsListCommand, orgsCreateCommand, orgsTransferCommand, orgsRemoveCommand] as const

const orgsCommand = Command.make('orgs').pipe(
  Command.withDescription('Manage enterprise organizations'),
  Command.withHandler(() =>
    Output.pipe(Effect.flatMap((output) => output.ok('enterprise.orgs', { commands: orgsSubcommands.map(toEntry) })))
  ),
  Command.withSubcommands(orgsSubcommands)
)

// === members ===

const roleFlag = Flag.choice('role', ['all', 'admin', 'owner', 'member', 'billing_manager']).pipe(
  Flag.optional,
  Flag.withDescription('Filter members by role')
)
const twoFaFlag = Flag.boolean('2fa-disabled').pipe(
  Flag.withDefault(false),
  Flag.withDescription('Only members without 2FA enabled')
)

const membersCommand = Command.make('members', {
  enterprise: enterpriseArg,
  role: roleFlag,
  twoFaDisabled: twoFaFlag,
}).pipe(
  Command.withDescription('List enterprise members'),
  Command.withHandler(({ enterprise, role, twoFaDisabled }) =>
    Enterprise.pipe(
      Effect.flatMap((ent) => {
        const input: MembersInput = {
          ...O.match(role, { onNone: () => ({}), onSome: (v) => ({ role: v }) }),
          twoFaDisabled,
        }
        return emit('enterprise.members', ent.members(enterprise, input), {
          next_actions: ['hubctl enterprise owners list <enterprise>'],
        })
      })
    )
  )
)

// === owners ===

const usernameArg = Argument.string('username').pipe(Argument.withDescription('Username'))

const ownersListCommand = Command.make('list', { enterprise: enterpriseArg }).pipe(
  Command.withDescription('List enterprise owners'),
  Command.withHandler(({ enterprise }) =>
    Enterprise.pipe(
      Effect.flatMap((ent) =>
        emit('enterprise.owners.list', ent.owners(enterprise), {
          next_actions: ['hubctl enterprise owners add <enterprise> <username> --yes'],
        })
      )
    )
  )
)

const ownersAddCommand = Command.make('add', { enterprise: enterpriseArg, username: usernameArg, yes: yesFlag }).pipe(
  Command.withDescription('Add an enterprise owner'),
  Command.withHandler(({ enterprise, username, yes }) =>
    Effect.gen(function* () {
      const output = yield* Output
      const ent = yield* Enterprise
      const confirmed = yield* confirmDestructive(
        `Add ${username} as an owner of enterprise ${enterprise}?`,
        yes,
        output
      )

      if (confirmed) {
        yield* emit('enterprise.owners.add', ent.addOwner(enterprise, username), {
          next_actions: ['hubctl enterprise owners list <enterprise>'],
        })
        return
      }

      yield* output.mode === 'json'
        ? output.fail('enterprise.owners.add', {
            code: 'confirmation_required',
            message: `Adding ${username} as owner of ${enterprise} was not confirmed`,
            fix: 're-run with --yes',
          })
        : output.ok('enterprise.owners.add', { enterprise, username, added: false, cancelled: true })
    })
  )
)

const ownersRemoveCommand = Command.make('remove', {
  enterprise: enterpriseArg,
  username: usernameArg,
  yes: yesFlag,
}).pipe(
  Command.withDescription('Remove an enterprise owner'),
  Command.withHandler(({ enterprise, username, yes }) =>
    Effect.gen(function* () {
      const output = yield* Output
      const ent = yield* Enterprise
      const confirmed = yield* confirmDestructive(
        `Remove ${username} as an owner of enterprise ${enterprise}?`,
        yes,
        output
      )

      if (confirmed) {
        yield* emit('enterprise.owners.remove', ent.removeOwner(enterprise, username), {
          next_actions: ['hubctl enterprise owners list <enterprise>'],
        })
        return
      }

      yield* output.mode === 'json'
        ? output.fail('enterprise.owners.remove', {
            code: 'confirmation_required',
            message: `Removing ${username} as owner of ${enterprise} was not confirmed`,
            fix: 're-run with --yes',
          })
        : output.ok('enterprise.owners.remove', { enterprise, username, removed: false, cancelled: true })
    })
  )
)

const ownersSubcommands = [ownersListCommand, ownersAddCommand, ownersRemoveCommand] as const

const ownersCommand = Command.make('owners').pipe(
  Command.withDescription('Manage enterprise owners'),
  Command.withHandler(() =>
    Output.pipe(
      Effect.flatMap((output) => output.ok('enterprise.owners', { commands: ownersSubcommands.map(toEntry) }))
    )
  ),
  Command.withSubcommands(ownersSubcommands)
)

// === billing ===

const billingNextActions = ['hubctl enterprise billing packages <enterprise>']

const usageCommand = Command.make('usage', { enterprise: enterpriseArg }).pipe(
  Command.withDescription('Show enterprise usage billing summary'),
  Command.withHandler(({ enterprise }) =>
    Enterprise.pipe(
      Effect.flatMap((ent) =>
        emit('enterprise.billing.usage', ent.billing(enterprise), { next_actions: billingNextActions })
      )
    )
  )
)

// `actions` is an alias for the usage summary (the Ruby `billing` command pulls
// the unified usage endpoint and the actions section is part of that summary).
const actionsCommand = Command.make('actions', { enterprise: enterpriseArg }).pipe(
  Command.withDescription('Show enterprise GitHub Actions billing summary'),
  Command.withHandler(({ enterprise }) =>
    Enterprise.pipe(
      Effect.flatMap((ent) =>
        emit('enterprise.billing.actions', ent.billing(enterprise), { next_actions: billingNextActions })
      )
    )
  )
)

const packagesCommand = Command.make('packages', { enterprise: enterpriseArg }).pipe(
  Command.withDescription('Show enterprise Packages billing'),
  Command.withHandler(({ enterprise }) =>
    Enterprise.pipe(
      Effect.flatMap((ent) =>
        emit('enterprise.billing.packages', ent.packagesBilling(enterprise), { next_actions: billingNextActions })
      )
    )
  )
)

const sharedStorageCommand = Command.make('shared-storage', { enterprise: enterpriseArg }).pipe(
  Command.withDescription('Show enterprise shared-storage billing'),
  Command.withHandler(({ enterprise }) =>
    Enterprise.pipe(
      Effect.flatMap((ent) =>
        emit('enterprise.billing.shared-storage', ent.sharedStorageBilling(enterprise), {
          next_actions: billingNextActions,
        })
      )
    )
  )
)

const billingSubcommands = [usageCommand, actionsCommand, packagesCommand, sharedStorageCommand] as const

const billingCommand = Command.make('billing').pipe(
  Command.withDescription('Show enterprise billing information'),
  Command.withHandler(() =>
    Output.pipe(
      Effect.flatMap((output) => output.ok('enterprise.billing', { commands: billingSubcommands.map(toEntry) }))
    )
  ),
  Command.withSubcommands(billingSubcommands)
)

// === licenses ===

const licensesCommand = Command.make('licenses', { enterprise: enterpriseArg }).pipe(
  Command.withDescription('Show enterprise consumed licenses'),
  Command.withHandler(({ enterprise }) =>
    Enterprise.pipe(
      Effect.flatMap((ent) =>
        emit('enterprise.licenses', ent.consumedLicenses(enterprise), {
          next_actions: ['hubctl enterprise members <enterprise>'],
        })
      )
    )
  )
)

// === audit-log ===

const orderFlag = Flag.choice('order', ['asc', 'desc']).pipe(
  Flag.withDefault('desc'),
  Flag.withDescription('Sort order')
)
const phraseFlag = Flag.string('phrase').pipe(Flag.optional, Flag.withDescription('Search phrase for audit entries'))
const afterFlag = Flag.string('after').pipe(Flag.optional, Flag.withDescription('Show entries after this cursor'))
const beforeFlag = Flag.string('before').pipe(Flag.optional, Flag.withDescription('Show entries before this cursor'))
const auditPerPageFlag = Flag.integer('per-page').pipe(
  Flag.optional,
  Flag.withDescription('Number of entries per page')
)

// The audit-log handler streams NDJSON: it tags each entry as a
// `{type:'audit-entry', ...}` event so `Output.stream` writes one JSON object
// per line, then a terminal envelope whose `result` is the array of those
// events (a non-streaming consumer reads only the final line). `Enterprise.auditLog`
// is the clean seam; we lift its paged array into a `Stream` of tagged events.
const auditLogCommand = Command.make('audit-log', {
  enterprise: enterpriseArg,
  order: orderFlag,
  phrase: phraseFlag,
  after: afterFlag,
  before: beforeFlag,
  perPage: auditPerPageFlag,
}).pipe(
  Command.withDescription('Show enterprise audit log'),
  Command.withHandler(({ after, before, enterprise, order, perPage, phrase }) =>
    Effect.gen(function* () {
      const ent = yield* Enterprise
      const output = yield* Output
      const input: AuditLogInput = {
        order,
        ...optionalField('phrase', phrase),
        ...optionalField('after', after),
        ...optionalField('before', before),
        ...optionalNumber('perPage', perPage),
      }
      const events$ = Stream.fromArrayEffect(ent.auditLog(enterprise, input)).pipe(
        Stream.map((entry) => ({ type: 'audit-entry', ...entry }))
      )
      // A typed Github error becomes a `Output.fail` envelope on the final line;
      // success streams the entries then the terminal envelope (already written
      // by `output.stream`, so the success branch is a no-op).
      yield* Effect.matchEffect(output.stream('enterprise.audit-log', events$), {
        onFailure: (error) => output.fail('enterprise.audit-log', error),
        onSuccess: () => Effect.void,
      })
    })
  )
)

// === sso ===

const loginArg = Argument.string('login').pipe(Argument.withDescription('User login'))

const ssoListCommand = Command.make('list', { enterprise: enterpriseArg }).pipe(
  Command.withDescription('List SAML SSO authorizations'),
  Command.withHandler(({ enterprise }) =>
    Enterprise.pipe(
      Effect.flatMap((ent) =>
        emit('enterprise.sso.list', ent.listSsoAuthorizations(enterprise), {
          next_actions: ['hubctl enterprise sso show <enterprise> <login>'],
        })
      )
    )
  )
)

const ssoShowCommand = Command.make('show', { enterprise: enterpriseArg, login: loginArg }).pipe(
  Command.withDescription('Show a SAML SSO authorization'),
  Command.withHandler(({ enterprise, login }) =>
    Enterprise.pipe(
      Effect.flatMap((ent) =>
        emit('enterprise.sso.show', ent.showSsoAuthorization(enterprise, login), {
          next_actions: ['hubctl enterprise sso list <enterprise>'],
        })
      )
    )
  )
)

const ssoRemoveCommand = Command.make('remove', { enterprise: enterpriseArg, login: loginArg, yes: yesFlag }).pipe(
  Command.withDescription('Remove a SAML SSO authorization'),
  Command.withHandler(({ enterprise, login, yes }) =>
    Effect.gen(function* () {
      const output = yield* Output
      const ent = yield* Enterprise
      const confirmed = yield* confirmDestructive(
        `Remove SAML SSO authorization for ${login} from enterprise ${enterprise}?`,
        yes,
        output
      )

      if (confirmed) {
        yield* emit('enterprise.sso.remove', ent.removeSsoAuthorization(enterprise, login), {
          next_actions: ['hubctl enterprise sso list <enterprise>'],
        })
        return
      }

      yield* output.mode === 'json'
        ? output.fail('enterprise.sso.remove', {
            code: 'confirmation_required',
            message: `Removing SAML SSO authorization for ${login} from ${enterprise} was not confirmed`,
            fix: 're-run with --yes',
          })
        : output.ok('enterprise.sso.remove', { enterprise, login, removed: false, cancelled: true })
    })
  )
)

const ssoSubcommands = [ssoListCommand, ssoShowCommand, ssoRemoveCommand] as const

const ssoCommand = Command.make('sso').pipe(
  Command.withDescription('Manage enterprise SAML SSO authorizations'),
  Command.withHandler(() =>
    Output.pipe(Effect.flatMap((output) => output.ok('enterprise.sso', { commands: ssoSubcommands.map(toEntry) })))
  ),
  Command.withSubcommands(ssoSubcommands)
)

// === stats ===

const statsCommand = Command.make('stats', { enterprise: enterpriseArg }).pipe(
  Command.withDescription('Show enterprise statistics'),
  Command.withHandler(({ enterprise }) =>
    Enterprise.pipe(
      Effect.flatMap((ent) =>
        emit('enterprise.stats', ent.stats(enterprise), {
          next_actions: ['hubctl enterprise billing usage <enterprise>'],
        })
      )
    )
  )
)

// === security-analysis ===

const securityGetCommand = Command.make('get', { enterprise: enterpriseArg }).pipe(
  Command.withDescription('Show enterprise security analysis settings'),
  Command.withHandler(({ enterprise }) =>
    Enterprise.pipe(
      Effect.flatMap((ent) =>
        emit('enterprise.security-analysis.get', ent.securityAnalysis(enterprise), {
          next_actions: ['hubctl enterprise security-analysis update <enterprise> --yes'],
        })
      )
    )
  )
)

const dependencyGraphFlag = Flag.boolean('dependency-graph').pipe(
  Flag.withDefault(false),
  Flag.withDescription('Enable dependency graph for new repositories')
)
const secretScanningFlag = Flag.boolean('secret-scanning').pipe(
  Flag.withDefault(false),
  Flag.withDescription('Enable secret scanning for new repositories')
)
const secretScanningPushFlag = Flag.boolean('secret-scanning-push-protection').pipe(
  Flag.withDefault(false),
  Flag.withDescription('Enable secret scanning push protection for new repositories')
)

// Map a boolean flag to a `{ key: true }` fragment only when set, mirroring the
// Ruby `update_options[:x] = options[:x] if options[:x]` truthy-only merge.
const flagWhenSet = (key: string, value: boolean): Record<string, boolean> => (value ? { [key]: true } : {})

const securityUpdateCommand = Command.make('update', {
  enterprise: enterpriseArg,
  dependencyGraph: dependencyGraphFlag,
  secretScanning: secretScanningFlag,
  secretScanningPush: secretScanningPushFlag,
  yes: yesFlag,
}).pipe(
  Command.withDescription('Update enterprise security analysis settings'),
  Command.withHandler(({ dependencyGraph, enterprise, secretScanning, secretScanningPush, yes }) =>
    Effect.gen(function* () {
      const output = yield* Output
      const ent = yield* Enterprise
      const confirmed = yield* confirmDestructive(
        `Update enterprise security analysis settings for ${enterprise}?`,
        yes,
        output
      )

      if (confirmed) {
        const input: SecurityAnalysisInput = {
          ...flagWhenSet('dependencyGraphEnabled', dependencyGraph),
          ...flagWhenSet('secretScanningEnabled', secretScanning),
          ...flagWhenSet('secretScanningPushProtectionEnabled', secretScanningPush),
        }
        yield* emit('enterprise.security-analysis.update', ent.updateSecurityAnalysis(enterprise, input), {
          next_actions: ['hubctl enterprise security-analysis get <enterprise>'],
        })
        return
      }

      yield* output.mode === 'json'
        ? output.fail('enterprise.security-analysis.update', {
            code: 'confirmation_required',
            message: `Updating security analysis settings for ${enterprise} was not confirmed`,
            fix: 're-run with --yes',
          })
        : output.ok('enterprise.security-analysis.update', { enterprise, updated: false, cancelled: true })
    })
  )
)

const securitySubcommands = [securityGetCommand, securityUpdateCommand] as const

const securityAnalysisCommand = Command.make('security-analysis').pipe(
  Command.withDescription('Manage enterprise security analysis settings'),
  Command.withHandler(() =>
    Output.pipe(
      Effect.flatMap((output) =>
        output.ok('enterprise.security-analysis', { commands: securitySubcommands.map(toEntry) })
      )
    )
  ),
  Command.withSubcommands(securitySubcommands)
)

// === group discovery ===

const subcommands = [
  showCommand,
  orgsCommand,
  membersCommand,
  ownersCommand,
  billingCommand,
  licensesCommand,
  auditLogCommand,
  ssoCommand,
  statsCommand,
  securityAnalysisCommand,
] as const

export const enterpriseCommand = (): Command.Command<
  'enterprise',
  Record<string, never>,
  Record<string, never>,
  never,
  Output | Enterprise
> =>
  Command.make('enterprise').pipe(
    Command.withDescription('Manage enterprise accounts'),
    Command.withHandler(() =>
      Output.pipe(Effect.flatMap((output) => output.ok('enterprise', { commands: subcommands.map(toEntry) })))
    ),
    Command.withSubcommands(subcommands)
  )
