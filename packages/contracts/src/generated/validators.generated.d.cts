export interface ValidationIssue {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
}

export interface StandaloneValidator {
  (data: unknown): boolean;
  errors?: ValidationIssue[] | null;
}

export const validateCatalog: StandaloneValidator;
export const validateWorkspace: StandaloneValidator;
export const validatePreferences: StandaloneValidator;
export const validateAdminNavigation: StandaloneValidator;
