import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import type { InputHTMLAttributes } from 'react'

import { api } from '../lib/api'

/** Fields the API will offer previously-typed values for. */
export type SuggestField = 'buyer_name' | 'part_title' | 'manufacturer' | 'acquired_from'

type Props = InputHTMLAttributes<HTMLInputElement> & { field: SuggestField }

/**
 * A text input that offers what has been typed into the same field before.
 *
 * A native `<datalist>` rather than a combobox: it keeps the field a plain
 * input, so typing something new is never fought with, and it behaves properly
 * with a phone keyboard — which is where most of this gets entered.
 */
export default function SuggestInput({ field, ...props }: Props) {
  const listId = useId()

  const options = useQuery({
    queryKey: ['suggestions', field],
    queryFn: () => api.get<string[]>(`/suggestions/${field}?limit=50`),
    // Names change rarely, and this renders on every sale and part form.
    staleTime: 5 * 60 * 1000,
  })

  return (
    <>
      <input {...props} list={listId} />
      <datalist id={listId}>
        {options.data?.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
    </>
  )
}
