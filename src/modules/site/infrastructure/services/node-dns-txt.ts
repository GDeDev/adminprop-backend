import { Injectable } from '@nestjs/common'
import { promises as dns } from 'node:dns'

import { DnsTxtPort } from '../../domain/site.ports'

/** `dns.resolveTxt` de Node: cada registro llega partido en trozos, se unen. */
@Injectable()
export class NodeDnsTxt extends DnsTxtPort {
  async resolveTxt(host: string): Promise<string[]> {
    try {
      const records = await dns.resolveTxt(host)
      return records.map((chunks) => chunks.join(''))
    } catch {
      // ENOTFOUND, ENODATA, timeout: para el usuario es lo mismo, "todavía no está".
      return []
    }
  }
}
