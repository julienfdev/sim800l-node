export default interface ModemResponse<T = any> {
    uuid: string,
    type: string,
    result: "success" | "failure"
    data?: {
        raw: string,
        processed: T
    }
    error?: {
        type: string,
        content: T
    }
}