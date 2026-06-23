import * as Effect from 'effect/Effect'
import * as O from 'effect/Option'
import { Argument, Flag, Prompt } from 'effect/unstable/cli'
import * as Command from 'effect/unstable/cli/Command'

import { Output } from '../output/service'
import { Enterprise } from '../services/enterprise'
import type { CreateOrgInput, MembersInput, OrganizationsInput } from '../services/enterprise'
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

// === group discovery ===

const subcommands = [orgsCommand, membersCommand, ownersCommand, billingCommand] as const

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
