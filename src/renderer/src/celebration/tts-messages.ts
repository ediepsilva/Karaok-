/**
 * Mensagens faladas ao fim da apresentação. Várias variações por faixa de nota para não repetir
 * sempre a mesma frase; a escolha entre elas é injetável (`pick`) para dar para testar.
 */

export type ScoreTier = 'excelente' | 'muito-bom' | 'bom' | 'regular' | 'incentivo'

export function scoreTier(score: number): ScoreTier {
  if (score >= 90) return 'excelente'
  if (score >= 70) return 'muito-bom'
  if (score >= 50) return 'bom'
  if (score >= 30) return 'regular'
  return 'incentivo'
}

/** `{singer}` e `{score}` são substituídos; `{singer}` cai para "cantor" quando não há nome. */
const TEMPLATES: Record<ScoreTier, string[]> = {
  excelente: [
    'Uau, {singer}! Isso foi incrível! {score} pontos!',
    'Que apresentação, {singer}! {score} pontos, meus parabéns!',
    '{singer} mandou muito bem! {score} pontos! A plateia adorou!',
    'Sensacional, {singer}! {score} pontos: um verdadeiro show!'
  ],
  'muito-bom': [
    'Muito bem, {singer}! {score} pontos!',
    'Ótima apresentação, {singer}! {score} pontos!',
    '{singer} cantou muito bem! {score} pontos!',
    'Show de bola, {singer}! {score} pontos!'
  ],
  bom: [
    'Boa, {singer}! {score} pontos!',
    '{singer} se saiu bem! {score} pontos!',
    'Legal, {singer}! {score} pontos. Continue praticando!'
  ],
  regular: [
    'Valeu a coragem, {singer}! {score} pontos!',
    '{singer}, {score} pontos. Da próxima vai ser ainda melhor!',
    'Obrigado por cantar, {singer}! {score} pontos!'
  ],
  incentivo: [
    'Parabéns pela coragem de cantar, {singer}!',
    '{singer}, o importante é se divertir! Continue cantando!',
    'Valeu, {singer}! Todo mundo começa de algum lugar!'
  ]
}

export interface CelebrationMessageInput {
  score: number
  singer: string
  /** Sorteia um índice em [0, length). Padrão: `Math.random`. Injetável para testes. */
  pick?: (length: number) => number
}

/** Frase pronta para o TTS, com o nome do cantor e a nota já preenchidos. */
export function pickCelebrationMessage({
  score,
  singer,
  pick = (n) => Math.floor(Math.random() * n)
}: CelebrationMessageInput): string {
  const tier = scoreTier(score)
  const pool = TEMPLATES[tier]
  const index = Math.min(pool.length - 1, Math.max(0, pick(pool.length)))
  const template = pool[index]!
  const name = singer.trim() || 'cantor'
  return template.replace(/\{singer\}/g, name).replace(/\{score\}/g, String(Math.round(score)))
}
