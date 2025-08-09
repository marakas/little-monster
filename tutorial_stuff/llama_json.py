from litellm import completion
import litellm
#litellm._turn_on_debug()

response = completion(
  model="ollama/llama3.2",
  messages=[
      {
          "role": "user",
          "content": "respond in json, what's the weather"
      }
  ],
  api_base="http://localhost:11434",
  #max_tokens=10,
  format = "json"
)
print(response.choices[0].message.content)