/* Domain vocabulary shared by the database schema, the server and the UI. */

export const ACCOUNT_TYPES = [
  'corrente',
  'poupanca',
  'pagamento',
  'investimento',
] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  corrente: 'Corrente',
  poupanca: 'Poupança',
  pagamento: 'Pagamento',
  investimento: 'Investimento',
}

export const PIX_KEY_TYPES = [
  'cpf',
  'cnpj',
  'telefone',
  'email',
  'aleatoria',
] as const
export type PixKeyType = (typeof PIX_KEY_TYPES)[number]

export const PIX_KEY_TYPE_LABELS: Record<PixKeyType, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  telefone: 'Celular',
  email: 'E-mail',
  aleatoria: 'Chave aleatória',
}

export const STATES = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const

export type PaymentStatus = 'pago' | 'pendente'

/** Shortest password accepted for unlocking the app. */
export const MIN_PASSWORD_LENGTH = 6
