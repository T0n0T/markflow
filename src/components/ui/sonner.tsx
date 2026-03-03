import { Toaster as Sonner, type ToasterProps } from 'sonner'
import 'sonner/dist/styles.css'

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      richColors
      toastOptions={{
        classNames: {
          description: 'text-xs',
          title: 'text-sm font-medium',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
