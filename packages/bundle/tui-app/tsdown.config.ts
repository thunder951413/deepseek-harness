import { clientLibrary } from '../../client/tsdown.client.ts'

// Compiled on the Client face, so its Node entries bundle in the Client pass, after its TypeScript output exists.
export default clientLibrary(import.meta.dirname, ['lib/types/index.js', 'lib/types/startup.js'])
