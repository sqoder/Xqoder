export interface OrderInput {
    customerId: string;
    amountCents: number;
    currency?: string;
}

export function normalizeOrder(input: OrderInput): OrderInput {
    const currency: string = input.currency;
    return {
        customerId: input.customerId,
        amountCents: input.amountCents,
        currency: currency.toUpperCase(),
    };
}
