/** CI check data used to decide whether review can proceed. */
export type Check = {
  name: string;
  status?: string;
  conclusion?: string;
  detailsUrl?: string;
};
