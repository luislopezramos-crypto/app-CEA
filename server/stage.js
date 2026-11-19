// Mover a un contacto de columna en el tablero (Nuevo → Interesado → Quiere cita → Cliente).
import { STAGES, addEvent, updateContact } from './db.js';
import { emit } from './realtime.js';

const LABELS = { nuevo: 'Nuevo', interesado: 'Interesado', quiere_cita: 'Quiere cita', paciente: 'Cliente' };

export async function moveStage(contact, stage, { manual = false } = {}) {
  if (!STAGES.includes(stage) || contact.stage === stage) return contact;
  // La IA y la agenda solo mueven hacia delante; la recepción puede moverla a mano a cualquier columna.
  if (!manual && STAGES.indexOf(stage) < STAGES.indexOf(contact.stage)) return contact;
  const updated = await updateContact(contact.id, { stage });
  emit.event(
    await addEvent({
      type: 'stage',
      contactId: contact.id,
      text: `${updated.name ?? 'Contacto sin nombre'} pasa a ${LABELS[stage]}`,
    }),
  );
  emit.contact(updated);
  return updated;
}
