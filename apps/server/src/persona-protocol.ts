export interface PersonaRef {
  root: string;
  path: string;
  id: string;
}
export interface PersonaSelection extends PersonaRef {
  revision: string;
}
export interface ResourceSelection {
  instructions?: string[];
  skills?: string[];
}
export interface PersonaParent extends PersonaRef {
  include?: ResourceSelection;
}
export type PersonaInstruction = { id: string; replace?: true } & (
  | { text: string; file?: never }
  | { file: string; text?: never }
);
export interface PersonaSkill {
  id: string;
  directory: string;
  replace?: true;
}
export interface PersonaDefinition {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  parents?: PersonaParent[];
  instructions?: PersonaInstruction[];
  skills?: PersonaSkill[];
  exclude?: ResourceSelection;
}
export interface PersonaDiagnostic {
  code: string;
  field?: string;
  resourceType?: "instructions" | "skills";
  resourceId?: string;
  refs?: PersonaRef[];
}
export interface PersonaSummary {
  ref: PersonaRef;
  name: string;
  description?: string;
  writable: boolean;
  valid: boolean;
  revision?: string;
  diagnostics: PersonaDiagnostic[];
  skillCount?: number;
}
export interface EffectiveResource {
  id: string;
  origin: PersonaRef;
  routes: PersonaRef[];
  replaced: PersonaRef[];
  file?: string;
  directory?: string;
  text?: string;
  nativeName?: string;
  description?: string;
  disableModelInvocation?: boolean;
}
export interface PersonaView {
  ref: PersonaRef;
  definition: PersonaDefinition;
  writable: boolean;
  definitionRevision: string;
  revision: string;
  effectiveRevision: string;
  instructions: EffectiveResource[];
  skills: EffectiveResource[];
  excluded: {
    type: "instructions" | "skills";
    id: string;
    origins: PersonaRef[];
  }[];
  diagnostics: PersonaDiagnostic[];
}
/** A valid definition remains inspectable when its resources cannot currently resolve. */
export type PersonaDocument = Omit<
  PersonaView,
  "revision" | "effectiveRevision"
> & {
  revision?: string;
  effectiveRevision?: string;
};
export interface AdmittedPersonaSummary {
  ref: PersonaRef;
  name: string;
  revision: string;
  effectiveRevision: string;
}
