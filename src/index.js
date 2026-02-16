
import { noChargeRedactor } from './noChargeRedactor.js'
import { surgeryCenterRedactor } from './surgeryCenterRedactor.js'

export const redactors = {
  nocharge: {
    label: "No-Charge Redactor",
    handler: noChargeRedactor
  },
  surgery: {
    label: "Surgery Center Redactor",
    handler: surgeryCenterRedactor
  }
}
