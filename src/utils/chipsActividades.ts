// src/utils/chipsActividades.ts (o donde tengas tus constantes en Calificaciones.tsx)

export const CHIPS_PRINCIPALES_POR_TIPO: Record<string, string[]> = {
  // ============================================================
  // ACTIVIDADES DE PRODUCCIÓN Y ENTREGA
  // ============================================================
  Tarea: [
    "Cumplió completamente",
    "Cumplió parcialmente",
    "No cumplió",
    "Entregó fuera de plazo",
    "Calidad destacada",
    "Requiere revisión",
    "Presentación desordenada",
    "Esfuerzo notable",
  ],
  "Proyecto Individual": [
    "Cumplió todos los requisitos",
    "Cumplió parcialmente",
    "No cumplió",
    "Creatividad destacada",
    "Profundidad en el análisis",
    "Superficial o incompleto",
    "Uso adecuado de fuentes",
    "Autonomía en el trabajo",
  ],
  "Proyecto Grupal": [
    "Aporte activo y constante",
    "Aporte mínimo",
    "No participó",
    "Lideró el equipo positivamente",
    "Trabajo colaborativo efectivo",
    "Conflictos en el grupo",
    "Cumplió su rol asignado",
    "Falta de compromiso",
  ],
  Taller: [
    "Realizó la actividad completa",
    "Realizó parcialmente",
    "No realizó",
    "Habilidades prácticas destacadas",
    "Requiere acompañamiento",
    "Autónomo en el proceso",
    "Sigue instrucciones con precisión",
    "Muestra curiosidad técnica",
  ],
  "Proyecto Trimestral": [
    "Integración de conocimientos",
    "Análisis crítico destacado",
    "Cumple requisitos mínimos",
    "Falta de profundidad",
    "No cumplió",
    "Excelente presentación final",
    "Investigación rigurosa",
    "Propone soluciones creativas",
  ],

  // ============================================================
  // ACTIVIDADES DE DEMOSTRACIÓN ORAL Y COMUNICACIÓN
  // ============================================================
  Lección: [
    "Domina el contenido",
    "Comprensión parcial",
    "No demuestra aprendizaje",
    "Participación activa",
    "Requiere refuerzo",
    "Argumenta con claridad",
    "Se expresa con seguridad",
    "Realiza conexiones con otros temas",
  ],
  Exposición: [
    "Domina el tema",
    "Comprensión parcial",
    "No demuestra aprendizaje",
    "Comunicación efectiva",
    "Material de apoyo adecuado",
    "Falta de preparación",
    "Seguridad al exponer",
    "Manejo adecuado del tiempo",
  ],
  "Animación a la Lectura": [
    "Lectura fluida y expresiva",
    "Lectura con dificultad",
    "No participó",
    "Comprensión profunda",
    "Comprensión parcial",
    "Identifica ideas principales",
    "Muestra interés y motivación",
    "Predice y opina sobre el texto",
  ],
  "Lectura Crítica": [
    "Análisis profundo y argumentado",
    "Análisis superficial",
    "No realizó",
    "Identifica la tesis del autor",
    "Contrasta con otras fuentes",
    "Requiere acompañamiento",
    "Distingue hechos de opiniones",
    "Emite juicios de valor fundados",
  ],

  // ============================================================
  // ACTIVIDADES DE EVALUACIÓN Y MEDICIÓN
  // ============================================================
  Prueba: [
    "Logro sobresaliente",
    "Logro esperado",
    "Logro en proceso",
    "Logro inicial",
    "No presentó",
    "Errores conceptuales",
    "Necesita recuperación",
    "Resolución creativa de problemas",
  ],
  "Evaluación Trimestral": [
    "Logro sobresaliente",
    "Logro esperado",
    "Logro en proceso",
    "Logro inicial",
    "No presentó",
    "Demuestra pensamiento crítico",
    "Aplica conocimientos en contexto",
    "Requiere plan de mejora",
  ],

  // ============================================================
  // ACTIVIDADES DE INVESTIGACIÓN Y PENSAMIENTO
  // ============================================================
  Investigación: [
    "Investigación rigurosa",
    "Investigación superficial",
    "No investigó",
    "Fuentes confiables y variadas",
    "Análisis crítico de datos",
    "Falta de rigor metodológico",
    "Conclusiones bien fundamentadas",
    "Plantea preguntas relevantes",
  ],
  "Razonamiento Lógico": [
    "Resuelve correctamente",
    "Resuelve con ayuda",
    "No resuelve",
    "Estrategia clara y eficiente",
    "Proceso lógico coherente",
    "Requiere refuerzo en conceptos base",
    "Plantea alternativas creativas",
    "Identifica patrones con facilidad",
  ],

  // ============================================================
  // ACTIVIDADES VIVENCIALES Y TRANSVERSALES
  // ============================================================
  "Acompañamiento Integral en el Aula": [
    "Reflexión profunda",
    "Reflexión superficial",
    "No participó",
    "Aporte significativo al grupo",
    "Muestra empatía y respeto",
    "Requiere seguimiento",
    "Identifica sus emociones",
    "Propone normas de convivencia",
  ],
  "Orientación Vocacional y Profesional (OVP)": [
    "Claridad en sus intereses",
    "Exploración abierta",
    "Requiere orientación",
    "Reflexión activa",
    "Reflexión superficial",
    "No participó",
    "Conoce sus fortalezas",
    "Investiga opciones futuras",
  ],
};

// Fallback por si se crea un tipo de actividad nuevo no mapeado
export const CHIPS_GENERICOS_DETALLADOS = [
  "Logro destacado",
  "Logro esperado",
  "En proceso",
  "Requiere apoyo",
  "No participó",
  "Esfuerzo notable",
  "Actitud positiva",
  "Falta de compromiso",
];