import { homedir } from 'node:os'
import { join } from 'node:path'

/** Default location of the private signing key: outside the repository, in the staff member's profile. */
export const defaultKeyPath = () => join(homedir(), '.hemisphere', 'content-signing-key.pem')
