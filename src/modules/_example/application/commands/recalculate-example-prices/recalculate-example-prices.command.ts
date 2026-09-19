export class RecalculateExamplePricesCommand {
  constructor(
    /** Aumento en puntos porcentuales, como string ("7.5" = 7,5%). */
    public readonly percentage: string,
    /**
     * Sólo para demostrar el reintento de la cola: el primer intento del
     * worker falla a propósito y el segundo termina bien.
     */
    public readonly simulateTransientFailure: boolean,
  ) {}
}
