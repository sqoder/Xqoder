export function sumPositive(numbers: number[]): number {
    return numbers.reduce((acc, value) => acc + value, 0);
}
