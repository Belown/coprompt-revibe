// Topics a session can start from: a dataset and a starting outline of small tasks. Nobody owns them at first:
// each person takes the tasks they want (the avatar on a heading), so a group has something concrete to split. Picked on the join screen; a room keeps
// its topic (S.scenario), which Reset restores and the LLM is told about. Titanic is the paper's user-study dataset;
// the others ship with scikit-learn, so they load in the browser without downloading anything.
// blocks: ['h', heading, level] or ['p', prompt, code]
export const SCENARIOS = {
  titanic: {
    title: 'Titanic: who survived?',
    blurb: 'Classification on the passenger list (the paper’s user-study dataset)',
    data: "The dataset is the Kaggle Titanic training set at 'data/titanic.csv'.",
    blocks: [
      ['h', 'Titanic Survival — Exploratory Data Analysis', 1],
      ['h', 'Data Preparation', 2],
      ['p', 'load data/titanic.csv into df', "import pandas as pd\ndf = pd.read_csv('data/titanic.csv')\ndf.head()"],
      ['h', '1. Deal with missing values in df', 3],
      ['h', '2. Encode categorical features in df', 3],
      ['h', 'Feature Analysis', 2],
      ['h', '3. Feature transformation', 3],
      ['h', '4. Correlation analysis', 3],
      ['h', '5. Deal with outliers', 3],
    ],
  },
  iris: {
    title: 'Iris: classify flower species',
    blurb: 'The smallest classic: 150 flowers, 4 measurements, 3 species',
    data: "The dataset is scikit-learn's Iris data (150 flowers), loaded by the first block into df with the columns 'sepal length (cm)', 'sepal width (cm)', 'petal length (cm)', 'petal width (cm)', 'target' (0, 1, 2) and 'species' (setosa, versicolor, virginica).",
    blocks: [
      ['h', 'Iris Flowers — Classify the Species', 1],
      ['h', 'Data Preparation', 2],
      ['p', 'load the iris dataset into df', "from sklearn.datasets import load_iris\niris = load_iris(as_frame=True)\ndf = iris.frame\ndf['species'] = df['target'].map(dict(enumerate(iris.target_names)))\ndf.head()"],
      ['h', '1. Summarize each feature by species', 3],
      ['h', '2. Split df into training and test sets', 3],
      ['h', 'Modeling', 2],
      ['h', '3. Plot petal length against petal width by species', 3],
      ['h', '4. Train a classifier and report its accuracy', 3],
      ['h', '5. Show the confusion matrix', 3],
    ],
  },
  wine: {
    title: 'Wine: which cultivar is it?',
    blurb: 'Exploration and clustering (the dataset in the paper’s figures)',
    data: "The dataset is scikit-learn's Wine recognition data (178 wines from 3 cultivars), loaded by the first block into df: 13 numeric features (alcohol, malic_acid, ash, alcalinity_of_ash, magnesium, total_phenols, flavanoids, nonflavanoid_phenols, proanthocyanins, color_intensity, hue, od280/od315_of_diluted_wines, proline) and 'target' (the cultivar, 0, 1, 2).",
    blocks: [
      ['h', 'Wine — Which Cultivar Is It?', 1],
      ['h', 'Data Preparation', 2],
      ['p', 'load the wine dataset into df', "from sklearn.datasets import load_wine\ndf = load_wine(as_frame=True).frame\ndf.head()"],
      ['h', '1. Describe the features and check for missing values', 3],
      ['h', '2. Standardize the features', 3],
      ['h', 'Exploration', 2],
      ['h', '3. Plot the correlation heatmap', 3],
      ['h', '4. Reduce to two dimensions with PCA and plot by class', 3],
      ['h', '5. Cluster with k-means and compare with the real classes', 3],
    ],
  },
  diabetes: {
    title: 'Diabetes: predict disease progression',
    blurb: 'Regression: 442 patients, 10 measurements, one number to predict',
    data: "The dataset is scikit-learn's Diabetes data (442 patients), loaded by the first block into df: ten standardized features (age, sex, bmi, bp, s1 to s6) and 'target', a measure of disease progression one year later.",
    blocks: [
      ['h', 'Diabetes — Predict Disease Progression', 1],
      ['h', 'Data Preparation', 2],
      ['p', 'load the diabetes dataset into df', "from sklearn.datasets import load_diabetes\ndf = load_diabetes(as_frame=True).frame\ndf.head()"],
      ['h', '1. Plot the distribution of the target', 3],
      ['h', '2. Find the features most correlated with the target', 3],
      ['h', 'Modeling', 2],
      ['h', '3. Split the data and fit a linear regression', 3],
      ['h', '4. Report R² and plot predicted against actual', 3],
      ['h', '5. Compare with a random forest', 3],
    ],
  },
};
export const scenario = id => SCENARIOS[id] || SCENARIOS.titanic; // rooms from before topics are Titanic
