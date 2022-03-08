export default interface ModemResponse{
    uuid: string,
    type: string,
    data: {
        raw: string,
        processed: any
    }
}