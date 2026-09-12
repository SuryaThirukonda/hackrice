/**
 * One sensor reading from the phone, kept as a flat tuple so it is cheap to produce at 60 Hz.
 * Inlined from the retired arena protocol: that module also carried the FastAPI wire types, none of
 * which the controller uses.
 *
 * [ t, ax, ay, az, agx, agy, agz, ralpha, rbeta, rgamma, oalpha, obeta, ogamma ]
 *   t          epoch milliseconds
 *   a*         acceleration with gravity removed (m/s^2)
 *   ag*        acceleration including gravity (m/s^2)
 *   r*         rotation rate (deg/s)
 *   o*         device orientation (deg)
 */
export type Sample = [number, number, number, number, number, number, number, number, number, number, number, number, number]
export const SAMPLE_LEN = 13
